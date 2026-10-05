#!/usr/bin/env node
/**
 * Tests for the lsp-first hook. Run from the kit root, see README.md.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { symbolOf, decide } = require('../lsp-first.js');

// LSP for TS and Python available, nothing searched yet
const env = (available = ['ts', 'py']) => {
  const keys = new Set();
  return { available, seen: (k) => keys.has(k) || (keys.add(k), false) };
};
const grep = (input, e = env()) => decide('Grep', input, e).decision;
const bash = (command, e = env()) => decide('Bash', { command }, e).decision;

describe('symbolOf', () => {
  for (const [p, s] of [['getUser', 'getUser'], ['\\bget_user\\b', 'get_user'], ['def get_user', 'get_user'],
    ['export function loadConfig', 'loadConfig'], ['class UserService', 'UserService'], ['useState\\(', 'useState'], ['getUser\\s*\\(', 'getUser'], ['\\bgetUser\\(', 'getUser']]) {
    it(`${p} -> ${s}`, () => assert.strictEqual(symbolOf(p), s));
  }
  for (const p of ['TODO', 'import', 'error', 'ab', 'Failed to load', 'user.*name', '"use client"', 'foo|bar', 'http://x']) {
    it(`${p} is text`, () => assert.strictEqual(symbolOf(p), null));
  }
});

describe('Grep tool', () => {
  it('denies a symbol search across the project', () => assert.strictEqual(grep({ pattern: 'getUser' }), 'deny'));
  it('denies a symbol search in .ts files', () => assert.strictEqual(grep({ pattern: 'getUser', glob: '**/*.ts' }), 'deny'));
  it('denies a symbol search with --type py', () => assert.strictEqual(grep({ pattern: 'get_user', type: 'py' }), 'deny'));
  it('allows the same search again (fallback)', () => {
    const e = env();
    assert.strictEqual(grep({ pattern: 'getUser' }, e), 'deny');
    assert.strictEqual(grep({ pattern: 'getUser' }, e), 'allow');
  });
  it('allows a text search', () => assert.strictEqual(grep({ pattern: 'Failed to load' }), 'allow'));
  it('allows a symbol search in Markdown', () => assert.strictEqual(grep({ pattern: 'getUser', glob: '*.md' }), 'allow'));
  it('allows a symbol search in .go files (no server of ours)', () => assert.strictEqual(grep({ pattern: 'getUser', glob: '*.go' }), 'allow'));
  it('allows everything without LSP', () => assert.strictEqual(grep({ pattern: 'getUser' }, env([])), 'allow'));
  it('allows .py when only TS has LSP', () => assert.strictEqual(grep({ pattern: 'get_user', glob: '*.py' }, env(['ts'])), 'allow'));
  it('allows every search once Claude has used LSP in the session', () =>
    assert.strictEqual(decide('Grep', { pattern: 'getUser' }, { ...env(), lspUsed: true }).decision, 'allow'));
  it('names a source file of the language for the LSP call', () => {
    const r = decide('Grep', { pattern: 'getUser' }, { ...env(), sampleFile: (l) => (l === 'ts' ? 'src/api/users.ts' : null) });
    assert.match(r.reason, /workspaceSymbol, filePath "src\/api\/users\.ts".*query "getUser"/);
  });
});

describe('Bash grep/rg', () => {
  for (const c of ['rg getUser', 'rg -n getUser src/', 'grep -rn "getUser" src', 'rg -t ts getUser', 'cd app && rg -w getUser',
    "grep -rn --include='*.py' get_user ."]) {
    it(`denies ${c}`, () => assert.strictEqual(bash(c), 'deny'));
  }
  for (const c of ['ps aux | grep node', 'git log | grep fixUser', 'grep getUser file.txt', 'grep -n getUser app.ts',
    'rg "Failed to load"', 'rg getUser docs/README.md', 'npm test', 'rg -g "*.md" getUser']) {
    it(`allows ${c}`, () => assert.strictEqual(bash(c), 'allow'));
  }
});

describe('hook process', () => {
  const hook = path.join(__dirname, '..', 'lsp-first.js');
  const run = (input, extra = {}) => spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...extra } }).stdout.trim();
  it('allows when LSP is not set up (no plugin, empty temp project)', () =>
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'getUser' }, session_id: 't', cwd: require('os').tmpdir() }, { INVENT_LSP_FIRST: 'on' }), '{}'));
  it('survives bad input', () => assert.strictEqual(spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' }).stdout.trim(), '{}'));
});

describe('/lsp on|off|status', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { switchedOn } = require('../lsp-first.js');
  const hook = path.join(__dirname, '..', 'lsp-first.js');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-toggle-'));
  spawnSync('git', ['init', '-q', repo]);
  const env = { ...process.env };
  delete env.INVENT_LSP_FIRST;
  const lsp = (arg) => spawnSync('node', [hook, arg], { cwd: repo, encoding: 'utf8', env });
  const local = path.join(repo, '.claude', 'settings.local.json');

  it('is off by default', () => assert.match(lsp('status').stdout, /lsp-first is OFF/));
  it('on writes settings.local.json and keeps other keys', () => {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { A: '1' } }));
    assert.match(lsp('on').stdout, /lsp-first is ON/);
    const s = JSON.parse(fs.readFileSync(local, 'utf8'));
    assert.deepStrictEqual(s, { permissions: { allow: ['Bash(ls)'] }, env: { A: '1', INVENT_LSP_FIRST: 'on' } });
    assert.strictEqual(switchedOn(repo), true);
  });
  it('keeps settings.local.json out of git, once', () => {
    lsp('on');
    assert.strictEqual(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout, '');
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    assert.strictEqual(exclude.split('.claude/settings.local.json').length - 1, 1);
  });
  // the repo has no package.json/pyproject.toml, whatever this machine has installed
  it('status names what is missing per language', () => {
    const out = lsp('status').stdout;
    assert.match(out, /TS\/JS : no LSP \(no tsconfig\.json/);
    assert.match(out, /Python: no LSP \(no pyproject\.toml/);
  });
  it('status says a TS project without TypeScript <= 6 has no LSP', () => {
    fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"x"}');
    assert.match(lsp('status').stdout, /TS\/JS : no LSP \(.*no TypeScript <= 6 in node_modules/);
    fs.unlinkSync(path.join(repo, 'package.json'));
  });
  it('off switches it off', () => {
    assert.match(lsp('off').stdout, /lsp-first is OFF/);
    assert.strictEqual(switchedOn(repo), false);
  });
  it('refuses to overwrite invalid JSON', () => {
    fs.writeFileSync(local, '{ broken');
    const r = lsp('on');
    assert.strictEqual(r.status, 1);
    assert.strictEqual(fs.readFileSync(local, 'utf8'), '{ broken');
  });
});
