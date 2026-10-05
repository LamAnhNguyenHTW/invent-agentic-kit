#!/usr/bin/env node
/**
 * Tests for the repo-setup skill files themselves.
 *
 * Run: node --test skills/repo-setup/scripts/tests/skill.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, '../..');
const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const baseline = fs.readFileSync(path.join(SKILL_DIR, 'baseline.md'), 'utf8');

// \r?\n: a Windows checkout has CRLF line endings
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)[1];
const field = (name, text = frontmatter) => (text.match(new RegExp(`^${name}: (.*?)\\r?$`, 'm')) || [])[1];

// Does an allowed-tools rule `Tool(pattern)` let this command run without a prompt?
const approves = (allowed, tool, command) => [...allowed.matchAll(/(\w+)\(([^)]*)\)/g)]
  .some(([, t, glob]) => t === tool && new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(command));
// How Claude runs a script once ${...} is filled in: an install path with a space, quoted
const asRun = (command) => command.replace(/\$\{CLAUDE_(SKILL_DIR|PLUGIN_ROOT)\}/,
  'C:/Users/Max Mustermann/.claude/plugins/cache/invent/invent-agentic-kit/0.4.0/skills/repo-setup') + ' save .repo-setup-backup CLAUDE.md';

describe('SKILL.md', () => {
  it('is named after its folder and agentic-kit-setup can start it', () => {
    assert.strictEqual(field('name'), path.basename(SKILL_DIR));
    assert.match(field('description'), /Use when the user runs \/repo-setup/);
    assert.strictEqual(field('disable-model-invocation'), undefined);
    assert.match(field('argument-hint'), /--no-questions/);
    assert.match(skill, /^Arguments: \$ARGUMENTS$/m);
  });

  it('pre-approves every script it runs, in Bash and PowerShell, and the scripts exist', () => {
    const commands = skill.match(/node "\$\{CLAUDE_SKILL_DIR\}\/[^"]+\.js"/g);
    assert.ok(commands.length > 0);
    for (const command of new Set(commands)) {
      for (const tool of ['Bash', 'PowerShell']) assert.ok(approves(field('allowed-tools'), tool, asRun(command)), `${tool}: ${command}`);
      const script = command.replace('node "${CLAUDE_SKILL_DIR}/', '').replace(/"$/, '');
      assert.ok(fs.existsSync(path.join(SKILL_DIR, script)), script);
    }
  });

  it('does not pre-approve edits or writes', () => {
    assert.doesNotMatch(field('allowed-tools'), /\b(Edit|Write)\b/);
  });

  it('only cites rules the baseline has', () => {
    const defined = new Set(baseline.match(/\*\*P-\d\d\*\*/g).map((id) => id.replace(/\*/g, '')));
    for (const id of new Set(skill.match(/P-\d\d/g))) assert.ok(defined.has(id), id);
  });
});

describe('agentic-kit-setup', () => {
  const kit = fs.readFileSync(path.join(SKILL_DIR, '../agentic-kit-setup/SKILL.md'), 'utf8');
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/skills/repo-setup/scripts/backup.js"';

  it('backs up with the pre-approved repo-setup script, in Bash and PowerShell', () => {
    assert.ok(kit.includes(`${command} save `));
    for (const tool of ['Bash', 'PowerShell']) assert.ok(approves(field('allowed-tools', kit), tool, asRun(command)), tool);
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'scripts/backup.js')));
  });

  it('runs repo-setup without questions', () => {
    assert.match(kit, /`repo-setup` skill[\s\S]*`--no-questions`/);
  });
});

describe('baseline.md', () => {
  it('links to official Anthropic pages only', () => {
    const urls = baseline.match(/https?:\/\/[^\s)]+/g);
    assert.ok(urls.length >= 3);
    for (const url of urls) {
      assert.match(new URL(url).hostname, /^(code\.claude\.com|claude\.com|www\.anthropic\.com)$/, url);
    }
  });

  it('gives every rule a source', () => {
    const rules = baseline.split(/\r?\n/).filter((line) => /^- \*\*P-\d\d\*\*/.test(line));
    assert.ok(rules.length > 0);
    for (const rule of rules) assert.match(rule, /\[S[123]\]$/, rule);
  });
});
