#!/usr/bin/env node
/**
 * LSP First - PreToolUse hook for Grep and Bash (grep/rg)
 * A text search for a symbol (`getUser`, `def get_user`) in code that a
 * language server covers is denied once, with a pointer to the LSP tool
 * (workspaceSymbol, goToDefinition, findReferences). The same search again in
 * the same session goes through: grep stays the fallback. Instructions in
 * CLAUDE.md alone didn't make Claude reach for LSP.
 *
 * Silent unless LSP is really there for the searched language: the server
 * binary on PATH and its official plugin enabled. Text searches (strings,
 * regexes, TODOs), searches in non-code files and grep filters on a pipe
 * (`ps aux | grep node`) pass.
 *
 * Off by default (an experiment): `/lsp on` sets INVENT_LSP_FIRST=on in the
 * repo's .claude/settings.local.json. The hook reads the settings files on
 * every call, so the switch applies to the next search.
 *
 *   node lsp-first.js on|off|status   switch it for the current repo
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LANGS = {
  ts: { exts: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'], bin: 'typescript-language-server',
    plugin: 'typescript-lsp@claude-plugins-official', markers: ['tsconfig.json', 'jsconfig.json', 'package.json'] },
  py: { exts: ['py', 'pyi'], bin: 'pyright-langserver',
    plugin: 'pyright-lsp@claude-plugins-official', markers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'uv.lock'] },
};
// rg --type names and grep --include globs map to these extensions
const TYPE_ALIAS = { js: 'js', ts: 'ts', typescript: 'ts', javascript: 'js', py: 'py', python: 'py' };
const NON_CODE = /\.(md|mdx|txt|json|ya?ml|toml|lock|csv|html?|css|scss|svg|env\w*|log|ini|cfg)$/i;
const WORDS = new Set(['import', 'export', 'from', 'return', 'async', 'await', 'default', 'require', 'print',
  'console', 'todo', 'fixme', 'xxx', 'hack', 'error', 'warning', 'true', 'false', 'null', 'none', 'self', 'this']);

// The searched symbol, or null for a text search. Accepts `\b`/`\<…\>` around
// a name and a leading declaration keyword.
function symbolOf(pattern) {
  const p = String(pattern || '').replace(/^\\b|\\b$|^\\<|\\>$/g, '').replace(/\\?\($/, '');
  const m = p.match(/^(?:(?:export\s+)?(?:def|class|function|func|fn|interface|type|enum|const|let|var|struct)\s+)?([A-Za-z_$][\w$]{2,})$/);
  return m && !WORDS.has(m[1].toLowerCase()) ? m[1] : null;
}

const extOf = (s) => (String(s || '').match(/\.(\w+)\}?$/) || [])[1];
const langOfExt = (ext) => Object.keys(LANGS).find((l) => LANGS[l].exts.includes(String(ext).toLowerCase()));

// { symbol, langs } for a code search, or null. `langs` null = the whole project.
function searchOf(toolName, input) {
  let pattern, scopes = [];
  if (toolName === 'Grep') {
    pattern = input.pattern;
    scopes = [input.glob, input.path, input.type && `.${TYPE_ALIAS[input.type] || input.type}`].filter(Boolean);
  } else if (toolName === 'Bash') {
    // grep/rg that starts a command (not a filter after a pipe) and searches files
    const m = String(input.command || '').match(/(?:^|[;&]\s*)(grep|rg)((?:\s+(?:-[tgef]\s+\S+|--(?:type|glob|include)\s+\S+|-\S+))*)\s+(?:"([^"]*)"|'([^']*)'|([^\s|;&'"]+))([^|;&\n]*)/);
    if (!m || (m[1] === 'grep' && !/\s-\w*[rR]/.test(m[2]))) return null;
    pattern = m[3] ?? m[4] ?? m[5];
    const opts = m[2] + m[6];
    scopes = [...opts.matchAll(/(?:--include=|-g\s*|--glob[=\s]|-t\s*|--type[=\s])["']?([^\s"']+)/g)]
      .map((g) => (TYPE_ALIAS[g[1]] ? `.${TYPE_ALIAS[g[1]]}` : g[1]))
      .concat(m[6].trim().split(/\s+/).filter((a) => a && !a.startsWith('-')));
  } else return null;

  const symbol = symbolOf(pattern);
  if (!symbol) return null;
  const files = scopes.filter((s) => extOf(s) || NON_CODE.test(s));
  if (files.some((s) => NON_CODE.test(s))) return null;
  const langs = [...new Set(files.map((s) => langOfExt(extOf(s))))];
  if (langs.includes(undefined)) return null; // some other language, no server of ours
  return { symbol, langs: langs.length ? langs : null };
}

function onPath(bin) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.ps1', ''] : [''];
  return (process.env.PATH || '').split(path.delimiter).some((dir) =>
    exts.some((e) => { try { return fs.statSync(path.join(dir, bin + e)).isFile(); } catch { return false; } }));
}

const localSettings = (cwd) => path.join(cwd, '.claude', 'settings.local.json');
// Settings files, closest scope first: local, project, user
function settings(cwd) {
  return [localSettings(cwd), path.join(cwd, '.claude', 'settings.json'), path.join(os.homedir(), '.claude', 'settings.json')]
    .map((f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } });
}

const pluginEnabled = (plugin, cwd) => settings(cwd).some((s) => s.enabledPlugins?.[plugin] === true);

// On only when switched on: the closest settings file that sets it wins, then the environment
function switchedOn(cwd) {
  const set = settings(cwd).map((s) => s.env?.INVENT_LSP_FIRST).find((v) => v !== undefined);
  return (set ?? process.env.INVENT_LSP_FIRST) === 'on';
}

// Languages with a working LSP in this project
function availableLangs(cwd) {
  return Object.keys(LANGS).filter((l) => LANGS[l].markers.some((f) => fs.existsSync(path.join(cwd, f)))
    && onPath(LANGS[l].bin) && pluginEnabled(LANGS[l].plugin, cwd));
}

// `/lsp on|off|status`: writes INVENT_LSP_FIRST to the repo's settings.local.json
function toggle(arg, cwd) {
  const file = localSettings(cwd);
  if (arg === 'on' || arg === 'off') {
    let s = {};
    if (fs.existsSync(file)) s = JSON.parse(fs.readFileSync(file, 'utf8')); // invalid JSON: throw, don't overwrite
    s.env = { ...s.env, INVENT_LSP_FIRST: arg };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  }
  const lines = [`lsp-first is ${switchedOn(cwd) ? 'ON' : 'OFF'} in ${cwd}` + (arg === 'on' || arg === 'off' ? ` (written to ${file})` : '')];
  for (const [l, { bin, plugin, markers }] of Object.entries(LANGS)) {
    const missing = [!markers.some((f) => fs.existsSync(path.join(cwd, f))) && `no ${markers.join('/')}`,
      !onPath(bin) && `${bin} not on PATH`, !pluginEnabled(plugin, cwd) && `${plugin} not enabled`].filter(Boolean);
    lines.push(`  ${l === 'ts' ? 'TS/JS ' : 'Python'}: ${missing.length ? 'no LSP (' + missing.join(', ') + ')' : 'LSP ready'}`);
  }
  return lines.join('\n');
}

// 'deny' the first time a symbol search hits an LSP-covered language, else 'allow'
function decide(toolName, input, { available, seen }) {
  const s = searchOf(toolName, input);
  if (!s) return { decision: 'allow' };
  const langs = s.langs || available;
  if (!langs.length || !langs.every((l) => available.includes(l))) return { decision: 'allow' };
  const key = JSON.stringify([toolName, input.pattern, input.path, input.glob, input.type, input.command]);
  if (seen(key)) return { decision: 'allow' };
  return {
    decision: 'deny',
    reason: `LSP first: "${s.symbol}" looks like a symbol. Use the LSP tool (workspaceSymbol to find it, `
      + 'goToDefinition, findReferences): it is exact and cheaper than a text search. If LSP can\'t answer '
      + '(not a symbol, server still starting, text in comments or strings), run the same search again and it goes through.',
  };
}

// Remembers searches per session in the temp dir, so a repeat goes through.
function seenStore(sessionId) {
  const file = path.join(os.tmpdir(), 'invent-lsp-first', String(sessionId || 'none').replace(/[^\w-]/g, '_'));
  return (key) => {
    let keys = [];
    try { keys = fs.readFileSync(file, 'utf8').split('\n'); } catch {}
    if (keys.includes(key)) return true;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, key.replace(/\n/g, ' ') + '\n'); } catch {}
    return false;
  };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const { tool_name, tool_input = {}, session_id, cwd = process.cwd() } = JSON.parse(input);
    if (tool_name === 'Bash' && !/\b(grep|rg)\b/.test(tool_input.command || '')) return console.log('{}');
    if (!switchedOn(cwd)) return console.log('{}');
    const r = decide(tool_name, { ...tool_input, command: tool_input.command?.replace(/\n/g, ' ') },
      { available: availableLangs(cwd), seen: seenStore(session_id) });
    if (r.decision !== 'deny') return console.log('{}');
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason } }));
  } catch {
    console.log('{}'); // a broken hint must never block a search
  }
}

if (require.main === module) {
  const arg = process.argv[2];
  if (['on', 'off', 'status'].includes(arg)) {
    try {
      console.log(toggle(arg, process.cwd()));
    } catch (e) {
      console.error(`Could not update ${localSettings(process.cwd())}: ${e.message}`);
      process.exit(1);
    }
  } else main();
} else {
  module.exports = { symbolOf, searchOf, decide, toggle, switchedOn };
}
