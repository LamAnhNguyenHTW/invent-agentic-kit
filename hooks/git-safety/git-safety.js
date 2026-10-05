#!/usr/bin/env node
/**
 * Git Safety - PreToolUse Hook for Bash
 * Blocks destructive git and gh CLI operations. Logs to: ~/.claude/hooks-logs/
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict' (default 'high')
 *   Override via the HOOK_SAFETY_LEVEL env var; invalid values fall back to the
 *   default. Prefer the env var over editing this file: plugin updates
 *   overwrite installed files.
 *   critical - no git-safety rules apply (defer entirely to block-dangerous-commands.js)
 *   high     - branch-aware guardrails (commit/merge/rebase/reset/push while on a
 *              protected branch), protected-branch deletion, direct pushes to
 *              main/master by name, and destructive gh CLI operations
 *   strict   - + force-push, so this hook is self-sufficient standalone
 *
 * Composition with block-dangerous-commands.js:
 *   That hook already blocks force-push (any, and to main/master) and
 *   `git reset --hard` on any branch. At the default 'high' level this hook adds
 *   only the complementary coverage above, so the two do not overlap. Raise this
 *   hook to 'strict' (or leave the sibling out) if you run git-safety on its own.
 *
 * invent patch: repo type via INVENT_REPO_TYPE ('demo' | 'prod', default and
 * fallback 'prod'). Demo repos may commit, merge, rebase, reset and push on
 * main and merge/close PRs and issues; deleting main (local or remote),
 * force-pushing to main and gh repo/release deletion stay blocked. Wired by invent-agentic-kit's hooks/hooks.json;
 * configure via "env" in .claude/settings.json, see the kit's README.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_SAFETY_LEVEL = 'high';
const SAFETY_LEVEL = ['critical', 'high', 'strict'].includes(process.env.HOOK_SAFETY_LEVEL)
  ? process.env.HOOK_SAFETY_LEVEL
  : DEFAULT_SAFETY_LEVEL;

// invent patch: demo repos relax the main-branch rules (see header)
const REPO_TYPE = process.env.INVENT_REPO_TYPE === 'demo' ? 'demo' : 'prod';
const DEMO_ALLOWED = new Set([
  'commit-on-protected', 'merge-on-protected', 'rebase-on-protected', 'reset-on-protected',
  'push-on-protected', 'push-main', 'push-master', 'gh-pr-merge', 'gh-pr-close', 'gh-issue-close',
]);

const PROTECTED_BRANCHES = ['main', 'master'];

// invent patch: `git` plus global options (`-C dir`, `-c k=v`, `--no-pager`), so
// `git -C ../x commit` doesn't slip past the subcommand rules
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;
const git = (rest) => new RegExp(GIT + rest);

const PATTERNS = [
  // STRICT - force-push is normally handled by block-dangerous-commands.js.
  // Only enforced here at 'strict' so git-safety is self-sufficient standalone.
  { level: 'strict', id: 'force-push',              regex: /\bgit\s+push\b.*(?:--force(?!-with-lease)|-f)\b/, reason: 'Force-pushing is not allowed' },

  // HIGH - complementary coverage the sibling hook does not provide

  // Block pushing directly to a protected branch by name
  // invent patch: match main/master only as a whole ref (`origin main`, `HEAD:main`, `+main`),
  // not inside branch names like feature/main-page, and only within the push command itself
  { level: 'high', id: 'push-main',                 regex: git(String.raw`push\b[^;&|]*(?:\s|:|\+)(?:refs\/heads\/)?main(?=\s|$|[;&|])`),   reason: 'Pushing to main is not allowed' },
  { level: 'high', id: 'push-master',               regex: git(String.raw`push\b[^;&|]*(?:\s|:|\+)(?:refs\/heads\/)?master(?=\s|$|[;&|])`), reason: 'Pushing to master is not allowed' },

  // invent patch: deleting or force-overwriting the remote main/master
  // (`push origin --delete main`, `push origin :main`, `push origin +main`, `push --force origin main`).
  // In prod push-main/push-master catch these first; demo repos skip those, so these stay in force.
  { level: 'high', id: 'push-delete-protected',     regex: git(String.raw`push\b(?=[^;&|]*\s(?:-d|--delete)\b)[^;&|]*\s(?:refs\/heads\/)?(?:main|master)(?=\s|$|[;&|])|push\b[^;&|]*\s:(?:refs\/heads\/)?(?:main|master)(?=\s|$|[;&|])`), reason: 'Deleting a protected branch is not allowed' },
  { level: 'high', id: 'push-force-protected',      regex: git(String.raw`push\b(?=[^;&|]*\s(?:--force(?:-with-lease)?(?:=\S*)?|-f)(?=\s|$|[;&|]))[^;&|]*(?:\s|:)(?:refs\/heads\/)?(?:main|master)(?=\s|$|[;&|])|push\b[^;&|]*(?:\s|:)\+(?:refs\/heads\/)?(?:main|master)(?=\s|$|[;&|])`), reason: 'Force-pushing to a protected branch is not allowed' },

  // Block deleting protected branches locally
  // invent patch: the delete flag anywhere before the name (`branch --delete --force main`, `branch -df main`)
  { level: 'high', id: 'branch-delete-protected',   regex: git(String.raw`branch\b(?=[^;&|]*\s(?:-[a-zA-Z]*[dD][a-zA-Z]*|--delete)(?=\s))[^;&|]*\s(?:main|master)(?=\s|$|[;&|])`), reason: 'Deleting a protected branch is not allowed' },

  // Block direct changes when on a protected branch
  { level: 'high', id: 'commit-on-protected',       regex: git(String.raw`commit\b`),                         reason: 'Committing directly on {branch} is not allowed', branchOnly: true },
  { level: 'high', id: 'merge-on-protected',        regex: git(String.raw`merge\b`),                          reason: 'Merging into {branch} is not allowed', branchOnly: true },
  { level: 'high', id: 'rebase-on-protected',       regex: git(String.raw`rebase\b`),                         reason: 'Rebasing {branch} is not allowed', branchOnly: true },
  // invent patch: only resets that move HEAD; unstaging (`git reset HEAD file`, `git reset -- file`) is fine
  { level: 'high', id: 'reset-on-protected',        regex: git(String.raw`reset\b(?=[^;&|]*(?:--(?:soft|mixed|hard|merge|keep)\b|\s(?:HEAD|@)[~^]|\sorigin\/|\s[0-9a-f]{7,40}(?![\w.\/])))`), reason: 'Resetting {branch} is not allowed', branchOnly: true },
  { level: 'high', id: 'push-on-protected',         regex: git(String.raw`push\b`),                           reason: 'Pushing from {branch} is not allowed', branchOnly: true },
  // invent patch: force-push while on main without naming it (`git push -f`). In prod
  // push-on-protected catches it first; demo repos skip that one.
  { level: 'high', id: 'push-force-on-protected',   regex: git(String.raw`push\b[^;&|]*\s(?:--force(?:-with-lease)?(?:=\S*)?|-f)(?=\s|$|[;&|])`), reason: 'Force-pushing from {branch} is not allowed', branchOnly: true },

  // Block destructive gh CLI operations
  { level: 'high', id: 'gh-pr-merge',               regex: /\bgh\s+pr\s+merge\b/,                             reason: 'Merging PRs via gh CLI is not allowed' },
  { level: 'high', id: 'gh-pr-close',               regex: /\bgh\s+pr\s+close\b/,                             reason: 'Closing PRs via gh CLI is not allowed' },
  { level: 'high', id: 'gh-issue-close',            regex: /\bgh\s+issue\s+close\b/,                          reason: 'Closing issues via gh CLI is not allowed' },
  { level: 'high', id: 'gh-release-delete',         regex: /\bgh\s+release\s+delete\b/,                       reason: 'Deleting releases via gh CLI is not allowed' },
  { level: 'high', id: 'gh-repo-delete',            regex: /\bgh\s+repo\s+delete\b/,                          reason: 'Deleting repos via gh CLI is not allowed' },
];

const LEVELS = { critical: 1, high: 2, strict: 3 };
const EMOJIS = { critical: '🚨', high: '⛔', strict: '⚠️' };
// invent patch: os.homedir() — an unset HOME crashed the hook at load, which fails open
const LOG_DIR = path.join(require('os').homedir(), '.claude', 'hooks-logs');

function log(data) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...data }) + '\n');
  } catch {}
}

// invent patch: branch of the session's cwd (from the hook input), or of the
// repo named by `git -C <dir>`, not of wherever the hook process happens to run
function gitDir(cwd, cmd = '') {
  const dashC = cmd.match(/\bgit(?:\s+(?:-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+-C\s+("[^"]*"|'[^']*'|\S+)/);
  return dashC ? path.resolve(cwd || '.', dashC[1].replace(/^["']|["']$/g, '')) : cwd;
}

function branchIn(dir) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: dir || undefined, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function checkCommand(cmd, branch = null, safetyLevel = SAFETY_LEVEL, { repoType = REPO_TYPE, cwd } = {}) {
  const threshold = LEVELS[safetyLevel] || LEVELS.high;
  for (const p of PATTERNS) {
    if (LEVELS[p.level] > threshold) continue;
    if (repoType === 'demo' && DEMO_ALLOWED.has(p.id)) continue; // invent patch: demo repos
    if (!p.regex.test(cmd)) continue;

    if (p.branchOnly) {
      if (!branch) branch = branchIn(gitDir(cwd, cmd));
      if (!PROTECTED_BRANCHES.includes(branch)) continue;
    }

    const reason = p.reason.replace('{branch}', branch || '');
    return { blocked: true, pattern: p, reason };
  }

  return { blocked: false };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd, permission_mode } = data;
    if (tool_name !== 'Bash' && tool_name !== 'PowerShell') return console.log('{}'); // invent patch: + PowerShell tool

    const cmd = tool_input?.command || '';
    const result = checkCommand(cmd, null, SAFETY_LEVEL, { cwd });

    if (result.blocked) {
      const p = result.pattern;
      log({ level: 'BLOCKED', id: p.id, priority: p.level, repo_type: REPO_TYPE, cmd, session_id, cwd, permission_mode });
      return console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `${EMOJIS[p.level]} [${p.id}] ${result.reason}`
        }
      }));
    }

    console.log('{}');
  } catch (e) {
    log({ level: 'ERROR', error: e.message });
    console.log('{}');
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { PATTERNS, PROTECTED_BRANCHES, LEVELS, SAFETY_LEVEL, REPO_TYPE, checkCommand };
}
