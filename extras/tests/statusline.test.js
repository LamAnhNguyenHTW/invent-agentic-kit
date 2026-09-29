#!/usr/bin/env node
/**
 * Tests for extras/statusline.js. Run from the kit root, see README.md ("Run the tests").
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-test-'));
process.env.CLAUDE_CONFIG_DIR = tmp;
const { priceFor, costOf, dailyCost, render } = require('../statusline.js');

describe('prices', () => {
  it('Opus 5.5 is cheaper than older Opus', () => {
    assert.deepStrictEqual(priceFor('claude-opus-5-5'), [4, 20, 0.20]);
    assert.deepStrictEqual(priceFor('claude-opus-4-8'), [5, 25, 0.50]);
  });
  it('Sonnet 5.x and Sonnet 4.x differ', () => {
    assert.deepStrictEqual(priceFor('claude-sonnet-5-5'), [2, 10, 0.20]);
    assert.deepStrictEqual(priceFor('claude-sonnet-4-6'), [3, 15, 0.30]);
  });
  it('Fable 5.1 is priced, not the fallback', () => assert.deepStrictEqual(priceFor('claude-fable-5-1'), [10, 50, 0.25]));
  it('1h cache writes cost 2x input, 5m writes 1.25x', () => {
    const usage = { cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 1e6 } };
    assert.strictEqual(costOf('claude-opus-5-5', usage), 4 * 2 + 4 * 1.25);
  });
});

describe('daily cost', () => {
  it('counts each API response once, even when it spans several transcript lines', () => {
    const dir = path.join(tmp, 'projects', 'p', 'session', 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const line = (id, req) => JSON.stringify({ timestamp: now, requestId: req, message: { id, model: 'claude-opus-5-5', usage: { output_tokens: 1e6 } } });
    // one response split into two lines, plus a second response: $20 + $20
    fs.writeFileSync(path.join(dir, 'a.jsonl'), [line('m1', 'r1'), line('m1', 'r1'), line('m2', 'r2')].join('\n'));
    assert.strictEqual(dailyCost(), 40);
  });
});

describe('render', () => {
  it('colours context by fill level and marks the daily sum as an estimate', () => {
    const out = render({ context_window: { used_percentage: 85, context_window_size: 1000000 } }, 12.345);
    assert.match(out, /\x1b\[31mctx:85%\/1000k/);
    assert.match(out, /today:~\$12\.35/);
  });
  it('shows nothing it has no data for', () => assert.strictEqual(render({}, null), ''));
});
