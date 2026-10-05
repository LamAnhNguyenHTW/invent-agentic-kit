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
    ['export function loadConfig', 'loadConfig'], ['class UserService', 'UserService'], ['useState\\(', 'useState']]) {
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
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'getUser' }, session_id: 't', cwd: require('os').tmpdir() }), '{}'));
  it('is off with INVENT_LSP_FIRST=off', () =>
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'getUser' }, session_id: 't' }, { INVENT_LSP_FIRST: 'off' }), '{}'));
  it('survives bad input', () => assert.strictEqual(spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' }).stdout.trim(), '{}'));
});
