#!/usr/bin/env node
/**
 * Tests for backup.js
 *
 * Run: node --test skills/repo-setup/scripts/tests/backup.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { save, restore, stamp } = require('../backup.js');

const SCRIPT_PATH = path.join(__dirname, '../backup.js');
const NOW = new Date(2026, 9, 4, 9, 5, 7);

let root;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-setup-')));
  fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  fs.writeFileSync(path.join(root, '.claude/rules/api.md'), 'Validate input.\n');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('save', () => {
  it('copies the files into a timestamped folder, with a .bak suffix', () => {
    const { dir, files } = save(root, '.repo-setup-backup', ['CLAUDE.md', '.claude/rules/api.md'], NOW);

    assert.strictEqual(dir, path.join(root, '.repo-setup-backup', '20261004-090507'));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md.bak'), 'utf8'), '# Project\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.claude/rules/api.md.bak'), 'utf8'), 'Validate input.\n');
    assert.deepStrictEqual(files, [
      { path: 'CLAUDE.md', bytes: 10 },
      { path: '.claude/rules/api.md', bytes: 16 },
    ]);
  });

  it('leaves no file Claude Code would load as instructions', () => {
    const { dir } = save(root, '.repo-setup-backup', ['CLAUDE.md', '.claude/rules/api.md'], NOW);
    const names = fs.readdirSync(dir, { recursive: true }).map((f) => path.basename(String(f)));

    assert.ok(!names.includes('CLAUDE.md'));
    assert.ok(!names.some((n) => n.endsWith('.md')));
  });

  it('keeps the backup out of git', () => {
    const { dir } = save(root, '.repo-setup-backup', ['CLAUDE.md'], NOW);

    assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*\n');
  });

  it('accepts a folder outside the repo', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-setup-out-')));
    try {
      const { dir } = save(root, outside, ['CLAUDE.md'], NOW);
      assert.ok(fs.existsSync(path.join(outside, '20261004-090507', 'CLAUDE.md.bak')));
      assert.strictEqual(dir, path.join(outside, '20261004-090507'));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a second backup into the same timestamped folder', () => {
    save(root, '.repo-setup-backup', ['CLAUDE.md'], NOW);

    assert.throws(() => save(root, '.repo-setup-backup', ['CLAUDE.md'], NOW), /already exists/);
  });

  it('refuses missing files, files outside the repo and an empty list before copying anything', () => {
    assert.throws(() => save(root, '.repo-setup-backup', ['CLAUDE.md', 'missing.md'], NOW));
    assert.throws(() => save(root, '.repo-setup-backup', ['../elsewhere.md'], NOW), /Not inside/);
    assert.throws(() => save(root, '.repo-setup-backup', [], NOW), /No files/);
    assert.ok(!fs.existsSync(path.join(root, '.repo-setup-backup')));
  });
});

describe('restore', () => {
  it('brings changed and deleted files back', () => {
    const { dir } = save(root, '.repo-setup-backup', ['CLAUDE.md', '.claude/rules/api.md'], NOW);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'changed\n');
    fs.rmSync(path.join(root, '.claude'), { recursive: true });

    restore(dir);

    assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# Project\n');
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude/rules/api.md'), 'utf8'), 'Validate input.\n');
  });
});

describe('command line', () => {
  it('saves from the current directory and prints the restore command', () => {
    const out = execFileSync('node', [SCRIPT_PATH, 'save', '.repo-setup-backup', 'CLAUDE.md'], { cwd: root, encoding: 'utf8' });
    const dir = out.match(/Backed up 1 file\(s\) to (.+)/)[1];

    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md.bak')));
    assert.ok(out.includes(`Restore with: node "${SCRIPT_PATH}" restore "${dir}"`));

    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'changed\n');
    execFileSync('node', [SCRIPT_PATH, 'restore', dir], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# Project\n');
  });

  it('exits 1 with the reason when a file is missing, 2 on wrong usage', () => {
    const missing = spawnSync('node', [SCRIPT_PATH, 'save', '.repo-setup-backup', 'missing.md'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /missing\.md/);

    assert.strictEqual(spawnSync('node', [SCRIPT_PATH], { cwd: root }).status, 2);
  });
});

describe('stamp', () => {
  it('formats local time as YYYYMMDD-HHMMSS', () => {
    assert.strictEqual(stamp(NOW), '20261004-090507');
  });
});
