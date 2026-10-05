#!/usr/bin/env node
/**
 * Statusline for Claude Code (Windows, macOS, Linux).
 *
 *   [Opus]  effort:medium  ctx:23%/1000k  $0.4123  today:~$12.34  +120/-45  5h:37%
 *   (main*)  ~/code/my-repo
 *
 * today:~$ is an estimate at API list prices, summed over all of today's
 * transcripts (subagents included). Not your bill on a subscription.
 * Installed to ~/.claude/invent-kit/ by /agentic-kit-setup.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const CACHE_FILE = path.join(CONFIG_DIR, '.cache', 'invent-statusline-daily.json');
const CACHE_MAX_AGE_MS = 60 * 1000;

// USD per million tokens: [input, output, cache read]. Cache writes are priced
// from input: 1.25x for the 5-minute TTL, 2x for the 1-hour TTL.
// Source: claude-api skill model table, cached 2026-09-25. First match wins.
const PRICES = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25]],
  [/fable|mythos/,         [10, 50, 1.00]],
  [/opus-5-5/,             [4, 20, 0.20]],
  [/opus/,                 [5, 25, 0.50]],
  [/sonnet-5/,             [2, 10, 0.20]],
  [/sonnet/,               [3, 15, 0.30]],
  [/haiku/,                [1, 5, 0.10]],
];
const FALLBACK_PRICE = [3, 15, 0.30];

const color = (text, code) => `\x1b[${code}m${text}\x1b[0m`;
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function priceFor(model) {
  const hit = PRICES.find(([re]) => re.test(model || ''));
  return hit ? hit[1] : FALLBACK_PRICE;
}

function costOf(model, usage) {
  const [inp, out, read] = priceFor(model);
  const cc = usage.cache_creation || {};
  const write1h = cc.ephemeral_1h_input_tokens || 0;
  const write5m = cc.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h);
  return ((usage.input_tokens || 0) * inp
    + write5m * inp * 1.25
    + write1h * inp * 2
    + (usage.cache_read_input_tokens || 0) * read
    + (usage.output_tokens || 0) * out) / 1e6;
}

function transcriptsChangedSince(dir, sinceMs, found = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) transcriptsChangedSince(p, sinceMs, found);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= sinceMs) found.push(p); } catch {}
    }
  }
  return found;
}

// One API response is written as several transcript lines (one per content
// block), each carrying the same usage. Count each response once.
function dailyCost(today = localDate()) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const seen = new Set();
  let total = 0;
  for (const file of transcriptsChangedSince(path.join(CONFIG_DIR, 'projects'), midnight.getTime())) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry.message;
      if (!msg || !msg.usage || !entry.timestamp || msg.model === '<synthetic>') continue;
      if (localDate(new Date(entry.timestamp)) !== today) continue;
      const key = `${msg.id}:${entry.requestId}`;
      if (msg.id && seen.has(key)) continue;
      seen.add(key);
      total += costOf(msg.model, msg.usage);
    }
  }
  return total;
}

function writeCache(date, value) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE + '.tmp', JSON.stringify({ date, value, at: Date.now() }));
    fs.renameSync(CACHE_FILE + '.tmp', CACHE_FILE);
  } catch {}
}

// Fresh cache: use it. Stale: show the old value and refresh in a detached
// process so the statusline never waits on a transcript scan. No cache: scan now.
function dailyCostCached() {
  const today = localDate();
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
  if (!cache || cache.date !== today) {
    const value = dailyCost(today);
    writeCache(today, value);
    return value;
  }
  if (Date.now() - cache.at > CACHE_MAX_AGE_MS) {
    writeCache(today, cache.value); // claim the refresh so parallel runs don't start another
    try {
      spawn(process.execPath, [__filename, '--refresh-daily'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {}
  }
  return cache.value;
}

function gitBranch(cwd) {
  try {
    const out = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=no'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true });
    const head = (out.match(/^# branch\.head (.+)$/m) || [])[1];
    if (!head || head === '(detached)') return '';
    const dirty = out.split('\n').some((l) => /^[12u] /.test(l));
    return head + (dirty ? '*' : '');
  } catch {
    return '';
  }
}

function render(input, daily) {
  const line1 = [];
  const line2 = [];

  if (input.model?.display_name) line1.push(color(`[${input.model.display_name}]`, 35));
  if (input.effort?.level) line1.push(color(`effort:${input.effort.level}`, 2));

  const pct = input.context_window?.used_percentage;
  if (pct != null) {
    const p = Math.floor(pct);
    const k = Math.round((input.context_window.context_window_size || 200000) / 1000);
    line1.push(color(`ctx:${p}%/${k}k`, p >= 80 ? 31 : p >= 50 ? 33 : 36));
  }

  const cost = input.cost?.total_cost_usd;
  if (cost != null) line1.push(color(`$${cost.toFixed(4)}`, 32));
  if (daily != null) line1.push(color(`today:~$${daily.toFixed(2)}`, 32));

  const added = input.cost?.total_lines_added || 0;
  const removed = input.cost?.total_lines_removed || 0;
  if (added || removed) line1.push(color(`+${added}/-${removed}`, 2));

  const fh = input.rate_limits?.five_hour?.used_percentage;
  if (fh != null) {
    const p = Math.floor(fh);
    line1.push(color(`5h:${p}%`, p >= 80 ? 31 : p >= 50 ? 33 : 32));
  }

  const cwd = input.cwd || input.workspace?.current_dir;
  if (cwd) {
    const branch = gitBranch(cwd);
    if (branch) line2.push(color(`(${branch})`, 33));
    const slash = (p) => p.replace(/\\/g, '/');
    const dir = slash(cwd);
    const home = slash(os.homedir());
    const lower = dir.toLowerCase();
    const inHome = lower === home.toLowerCase() || lower.startsWith(home.toLowerCase().replace(/\/$/, '') + '/');
    line2.push(color(inHome ? '~' + dir.slice(home.replace(/\/$/, '').length) : dir, 36));
  }

  return [line1, line2].filter((l) => l.length).map((l) => l.join('  ')).join('\n');
}

async function main() {
  if (process.argv.includes('--refresh-daily')) {
    writeCache(localDate(), dailyCost());
    return;
  }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  let daily = null;
  try { daily = dailyCostCached(); } catch {}
  process.stdout.write(render(input, daily) + '\n');
}

if (require.main === module) {
  main();
} else {
  module.exports = { priceFor, costOf, dailyCost, render, localDate };
}
