#!/usr/bin/env node
/**
 * Block Dangerous Commands - PreToolUse Hook for Bash
 * Blocks dangerous patterns before execution. Logs to: ~/.claude/hooks-logs/
 *
 * SAFETY_LEVEL: 'critical' | 'high' | 'strict' (default: 'high')
 *   critical - Only catastrophic: rm -rf ~, dd to disk, fork bombs
 *   high     - + risky: force push main, secrets exposure, git reset --hard
 *   strict   - + cautionary: any force push, sudo rm, docker prune
 * Override via HOOK_SAFETY_LEVEL; invalid values fall back to the default
 * (don't edit this file: plugin updates overwrite it).
 *
 * Ask mode (opt-in, per level): set HOOK_ASK_CRITICAL / HOOK_ASK_HIGH /
 * HOOK_ASK_STRICT to the literal string "true" to have that level prompt the
 * user ("ask") instead of blocking outright ("deny").
 *
 * invent patch: wired by invent-agentic-kit's hooks/hooks.json (Bash and
 * PowerShell). Set the variables above via "env" in .claude/settings.json,
 * see the kit's README.
 */

const fs = require('fs');
const path = require('path');

// Safety level, env-overridable via HOOK_SAFETY_LEVEL. Invalid or unset values
// fall back to the default.
const DEFAULT_SAFETY_LEVEL = 'high';
const SAFETY_LEVEL = ['critical', 'high', 'strict'].includes(process.env.HOOK_SAFETY_LEVEL)
  ? process.env.HOOK_SAFETY_LEVEL
  : DEFAULT_SAFETY_LEVEL;

// Ask mode per level: if true, prompts the user instead of blocking outright.
// When ask=true, the hook returns decision "ask" so Claude Code shows the
// reason and lets the user decide. When ask=false (default), the hook denies.
// Env overrides: HOOK_ASK_CRITICAL, HOOK_ASK_HIGH, HOOK_ASK_STRICT
const envBool = (key, fallback) => key in process.env ? process.env[key] === 'true' : fallback;
const ASK = {
  critical: envBool('HOOK_ASK_CRITICAL', false),
  high:     envBool('HOOK_ASK_HIGH', false),
  strict:   envBool('HOOK_ASK_STRICT', false),
};

// invent patch: `git` plus global options (`-C dir`, `-c k=v`, `--no-pager`), so
// `git -C . reset --hard` doesn't slip past the git rules (same prefix as git-safety.js)
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;
const git = (rest) => new RegExp(GIT + rest);

// invent patch: `rm`, then flags and operands as whole tokens. Upstream's
// `(-.+\s+)*` nests a space-matching `.+` in a repeat, which backtracks
// exponentially on long commands and outlasts the hook timeout (fails open).
// `Bash(rm *)` is a permission rule passed as an argument, not a subshell: a
// subshell's `(` never follows a word char.
const RM_WORD = String.raw`(?<!\w\()\brm`;
const RM = RM_WORD + String.raw`[ \t]+(?:-[^\s;&|]+[ \t]+(?:[^\s;&|]+[ \t]+)*)?`;
// Any operands, flags or not: GNU rm reads flags after operands (`rm x -rf ~`)
const RM_ANY = RM_WORD + String.raw`[ \t]+(?:[^\s;&|]+[ \t]+)*`;
// A target ends at whitespace, an operator, or a `)` or backtick that closes a
// subshell: `(rm -rf *)`, `$(rm -rf ~)`
const END = String.raw`(?:\s|$|[;&|)\x60])`;
// `~`, `~/*`, `"$HOME"/`: a trailing `/` or `/*` is still the home dir
const home = (t) => String.raw`["']?(?:${t})(?:\/\*?)?["']?(?:\/\*?)?`;
// PowerShell or Git Bash: `Remove-Item`, `"rm"`, `rm.exe`, `/usr/bin/rm`, not `rm.sh`
const PS_RM = String.raw`(?<![\w.-])["']*(?:Remove-Item|ri|rm|del|rmdir|rd)(?:\.exe)?["']*(?=\s)`;
const PS_RM_NO_RM = String.raw`(?<![\w.-])["']*(?:Remove-Item|ri|del|rmdir|rd)(?:\.exe)?["']*(?=\s)`;

const PATTERNS = [
  // CRITICAL - Catastrophic, unrecoverable
  { level: 'critical', id: 'rm-home',          regex: new RegExp(RM + home('~') + END),                                    reason: 'rm targeting home directory' },
  { level: 'critical', id: 'rm-home-var',      regex: new RegExp(RM + home(String.raw`\$HOME`) + END),                     reason: 'rm targeting $HOME' },
  { level: 'critical', id: 'rm-home-trailing', regex: new RegExp(RM_ANY + home(String.raw`~|\$HOME`) + END),               reason: 'rm with trailing ~/ or $HOME' },
  { level: 'critical', id: 'rm-root',          regex: new RegExp(RM + String.raw`\/(?:\*|` + END + ')'),                     reason: 'rm targeting root filesystem' },
  { level: 'critical', id: 'rm-system',        regex: new RegExp(RM + String.raw`\/(?:etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)(?:\/|` + END + ')'), reason: 'rm targeting system directory' },
  { level: 'critical', id: 'rm-cwd',           regex: new RegExp(RM + String.raw`(?:\.\/?|\*|\.\/\*)` + END),                reason: 'rm deleting current directory contents' },
  { level: 'critical', id: 'dd-disk',          regex: /\bdd\b.+of=\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z]|xvd[a-z])/,         reason: 'dd writing to disk device' },
  { level: 'critical', id: 'mkfs',             regex: /\bmkfs(\.\w+)?\s+\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/,            reason: 'mkfs formatting disk' },
  // invent patch: PowerShell equivalents (the PowerShell tool on Windows bypassed the rm-* rules)
  { level: 'critical', id: 'ps-rm-home',       regex: new RegExp(PS_RM + String.raw`[^;|&\n]*\s["']?(~|\$HOME|\$env:USERPROFILE)[\\/]?\*?["']?(\s|$|[;|])`, 'i'), reason: 'Remove-Item targeting home directory' },
  { level: 'critical', id: 'ps-rm-drive',      regex: new RegExp(PS_RM + String.raw`[^;|&\n]*\s["']?[A-Za-z]:[\\/]?\*?["']?(\s|$|[;|&])`, 'i'),           reason: 'Remove-Item targeting a drive root' },
  { level: 'critical', id: 'ps-rm-cwd',        regex: new RegExp(PS_RM_NO_RM + String.raw`[^;|&]*\s["']?(?:\.[\\/]?\*?|\*)["']?(?=\s|$|[;|&])`, 'i'),             reason: 'Remove-Item deleting current directory contents' },
  { level: 'critical', id: 'ps-format-disk',   regex: /\b(Format-Volume|Clear-Disk|Initialize-Disk)\b/i,                                                   reason: 'formatting or wiping a disk' },
  { level: 'critical', id: 'fork-bomb',       regex: /:\(\)\s*\{.*:\s*\|\s*:.*&/,                                         reason: 'fork bomb detected' },

  // HIGH - Significant risk, data loss, security
  { level: 'high', id: 'curl-pipe-sh',   regex: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/,                                        reason: 'piping URL to shell (RCE risk)' },
  { level: 'high', id: 'git-force-main', regex: git(String.raw`push\b(?!.+--force-with-lease).+(--force|-f)\b.+\b(main|master)\b`), reason: 'force push to main/master' },
  { level: 'high', id: 'git-reset-hard', regex: git(String.raw`reset\s+--hard`),                                          reason: 'git reset --hard loses uncommitted work' },
  { level: 'high', id: 'git-clean-f',    regex: git(String.raw`clean\s+(-\w*f|-f)`),                                      reason: 'git clean -f deletes untracked files' },
  { level: 'high', id: 'chmod-777',      regex: /\bchmod\b.+\b777\b/,                                                     reason: 'chmod 777 is a security risk' },
  { level: 'high', id: 'docker-vol-rm',  regex: /\bdocker\s+volume\s+(rm|prune)/,                                         reason: 'docker volume deletion loses data' },

  // STRICT - Cautionary, context-dependent
  { level: 'strict', id: 'git-force-any',    regex: git(String.raw`push\b(?!.+--force-with-lease).+(--force|-f)\b`),       reason: 'force push (use --force-with-lease)' },
  { level: 'strict', id: 'git-checkout-dot', regex: git(String.raw`checkout\s+\.`),                                        reason: 'git checkout . discards changes' },
  { level: 'strict', id: 'sudo-rm',          regex: /\bsudo\s+rm\b/,                                                       reason: 'sudo rm has elevated privileges' },
  { level: 'strict', id: 'docker-prune',     regex: /\bdocker\s+(system|image)\s+prune/,                                   reason: 'docker prune removes images' },
  { level: 'strict', id: 'crontab-r',        regex: /\bcrontab\s+-r/,                                                      reason: 'removes all cron jobs' },
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

function checkCommand(cmd, safetyLevel = SAFETY_LEVEL) {
  const threshold = LEVELS[safetyLevel] || 2;
  for (const p of PATTERNS) {
    if (LEVELS[p.level] <= threshold && p.regex.test(cmd)) {
      return { blocked: true, pattern: p };
    }
  }
  return { blocked: false, pattern: null };
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const data = JSON.parse(input);
    const { tool_name, tool_input, session_id, cwd, permission_mode } = data;
    if (tool_name !== 'Bash' && tool_name !== 'PowerShell') return console.log('{}'); // invent patch: + PowerShell tool

    const cmd = tool_input?.command || '';
    const result = checkCommand(cmd);

    if (result.blocked) {
      const p = result.pattern;
      const shouldAsk = ASK[p.level] === true;
      const decision = shouldAsk ? 'ask' : 'deny';
      log({ level: shouldAsk ? 'ASK' : 'BLOCKED', id: p.id, priority: p.level, decision, cmd, session_id, cwd, permission_mode });
      return console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: `${EMOJIS[p.level]} [${p.id}] ${p.reason}`
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
  module.exports = { PATTERNS, LEVELS, SAFETY_LEVEL, ASK, checkCommand };
}
