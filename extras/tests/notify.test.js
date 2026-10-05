#!/usr/bin/env node
/**
 * Tests for extras/notify.js. Run from the kit root, see README.md ("Run the tests").
 * A project folder name ends up inside an AppleScript or PowerShell string, so
 * quotes in it must not break out of that string.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');

const { command } = require('../notify.js');

const real = process.platform;
const on = (platform) => Object.defineProperty(process, 'platform', { value: platform });
afterEach(() => on(real));

describe('notify command()', () => {
  it('macOS: osascript with quotes and backslashes escaped', () => {
    on('darwin');
    const [cmd, args] = command('done in a"b\\c');
    assert.strictEqual(cmd, 'osascript');
    assert.strictEqual(args[1], 'display notification "done in a\\"b\\\\c" with title "Claude Code"');
  });

  it('Windows: PowerShell toast with single quotes doubled and markup dropped', () => {
    on('win32');
    const [cmd, args] = command("it's <b>&");
    assert.strictEqual(cmd, 'powershell');
    const script = args[args.length - 1];
    assert.match(script, /CreateTextNode\('it''s b'\)/);
    assert.doesNotMatch(script, /<b>|&/);
  });

  it('Linux: notify-send gets the text as a separate argument', () => {
    on('linux');
    assert.deepStrictEqual(command('a"b'), ['notify-send', ['Claude Code', 'a"b']]);
  });
});
