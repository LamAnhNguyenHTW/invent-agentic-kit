#!/usr/bin/env node
/**
 * Tests for the invent patches on top of karanb192/claude-code-hooks.
 * Run from the kit root, see README.md ("Run the tests").
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

delete process.env.HOOK_SAFETY_LEVEL;

const ps = require('../protect-secrets/protect-secrets.js');
const bd = require('../block-dangerous-commands/block-dangerous-commands.js');
const gs = require('../git-safety/git-safety.js');

const win = (...parts) => parts.join('\\');

function runHook(script, input, env = {}) {
  const r = spawnSync('node', [path.join(__dirname, '..', script)], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, out: r.stdout };
}

describe('protect-secrets: Windows paths', () => {
  for (const p of [
    win('C:', 'proj', '.env'),
    win('C:', 'proj', '.env.local'),
    win('C:', 'Users', 'o', '.ssh', 'id_rsa'),
    win('C:', 'Users', 'o', '.aws', 'credentials'),
    win('C:', 'proj', 'secrets.json'),
  ]) {
    it(`blocks Read ${p}`, () => assert.strictEqual(ps.check('Read', { file_path: p }).blocked, true));
  }
  it('allows Read of .env.example', () =>
    assert.strictEqual(ps.check('Read', { file_path: win('C:', 'proj', '.env.example') }).blocked, false));
  it('blocks Grep on a Windows .env path', () =>
    assert.strictEqual(ps.check('Grep', { path: win('C:', 'proj', '.env') }).blocked, true));
});

describe('protect-secrets: allowlist only exempts its own token', () => {
  it('blocks cat .env; ls .env.example', () =>
    assert.strictEqual(ps.check('Bash', { command: 'cat .env; ls .env.example' }).blocked, true));
  it('allows cat .env.example', () =>
    assert.strictEqual(ps.check('Bash', { command: 'cat .env.example' }).blocked, false));
  it('blocks cp .env.example .env (copies onto .env)', () =>
    assert.strictEqual(ps.check('Bash', { command: 'cp .env.example .env' }).blocked, true));
});

describe('protect-secrets: PowerShell tool', () => {
  for (const c of ['Get-Content .env', 'gc .\\.env', 'type C:\\proj\\.env', 'Select-String -Path .env -Pattern KEY', 'Get-Content ~/.ssh/id_rsa']) {
    it(`blocks ${c}`, () => assert.strictEqual(ps.check('PowerShell', { command: c }).blocked, true));
  }
  it('allows Get-Content .env.example', () =>
    assert.strictEqual(ps.check('PowerShell', { command: 'Get-Content .env.example' }).blocked, false));
  it('allows Get-Content README.md', () =>
    assert.strictEqual(ps.check('PowerShell', { command: 'Get-Content README.md' }).blocked, false));
  it('denies end to end', () => {
    const r = runHook('protect-secrets/protect-secrets.js', { tool_name: 'PowerShell', tool_input: { command: 'Get-Content .env' } });
    assert.match(r.out, /"permissionDecision":"deny"/);
  });
});

describe('block-dangerous-commands: PowerShell', () => {
  for (const c of ['Remove-Item -Recurse -Force ~', 'Remove-Item -Recurse -Force $env:USERPROFILE', 'rm -r -fo $HOME\\', 'Remove-Item -Recurse C:\\', 'Format-Volume -DriveLetter D']) {
    it(`blocks ${c}`, () => assert.strictEqual(bd.checkCommand(c).blocked, true));
  }
  for (const c of ['Remove-Item -Recurse node_modules', 'Remove-Item C:\\proj\\build -Recurse', 'Remove-Item .\\dist\\*']) {
    it(`allows ${c}`, () => assert.strictEqual(bd.checkCommand(c).blocked, false));
  }
  it('denies PowerShell tool end to end', () => {
    const r = runHook('block-dangerous-commands/block-dangerous-commands.js', { tool_name: 'PowerShell', tool_input: { command: 'git reset --hard' } });
    assert.match(r.out, /"permissionDecision":"deny"/);
  });
});

describe('git-safety: main only as a whole ref', () => {
  for (const c of ['git push origin main', 'git push origin HEAD:main', 'git push origin +main', 'git push origin main && echo ok', 'git push origin refs/heads/master']) {
    it(`blocks ${c}`, () => assert.strictEqual(gs.checkCommand(c, 'feature/x').blocked, true));
  }
  for (const c of ['git push origin feature/main-page', 'git push -u origin fix/master-data', 'git push origin main-v2']) {
    it(`allows ${c}`, () => assert.strictEqual(gs.checkCommand(c, 'feature/x').blocked, false));
  }
});

describe('hooks survive an unset HOME', () => {
  for (const script of ['protect-secrets/protect-secrets.js', 'block-dangerous-commands/block-dangerous-commands.js', 'git-safety/git-safety.js']) {
    it(script, () => {
      const env = { ...process.env };
      delete env.HOME;
      const r = spawnSync('node', [path.join(__dirname, '..', script)], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard' } }), encoding: 'utf8', env,
      });
      assert.strictEqual(r.status, 0, r.stderr);
    });
  }
});

describe('ponytail-activate', () => {
  it('prints the ruleset without frontmatter', () => {
    const r = runHook('ponytail-activate/ponytail-activate.js', {});
    assert.match(r.out, /^# Ponytail/);
  });
  it('prints nothing with PONYTAIL_MODE=off', () => {
    assert.strictEqual(runHook('ponytail-activate/ponytail-activate.js', {}, { PONYTAIL_MODE: 'off' }).out, '');
  });
});
