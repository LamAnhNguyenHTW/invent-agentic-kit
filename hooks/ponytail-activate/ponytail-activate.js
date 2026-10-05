#!/usr/bin/env node
/**
 * Ponytail Activate - SessionStart hook
 * Injects the ponytail ruleset into every session. Installed passively, the
 * skill only loads when Claude decides to invoke it, which is unreliable (not
 * at all in a JetBrains test, 2026-07; in 1 of 2 coding runs, 2026-10), so we
 * load it up front. Slim replacement for upstream's activation hooks (no
 * statusline, no mode tracking). PONYTAIL_MODE=off disables this injection
 * only; the skill stays installed and Claude may still invoke it. Runs on
 * startup, clear and compact, not on resume: the resumed transcript already
 * holds the injected text. After clear or compact the ruleset is back at its
 * default (full), even if the user had said "stop ponytail".
 */

const fs = require('fs');
const path = require('path');

// Parts of the upstream text that don't apply to every Invent session: a
// hardware aside and a pointer to another plugin. The skill file stays as
// upstream ships it; if upstream rewords them, they simply stay in.
// `\r?\n`: a Windows checkout has CRLF line endings.
const OFF_TOPIC = [
  /\r?\n\r?\nHardware is never the ideal[\s\S]*?(?=\r?\n\r?\n)/,
  / \(pair with Caveman for\s+terse prose\)/,
];
const offTopicRemoved = (text) => OFF_TOPIC.reduce((t, re) => t.replace(re, ''), text);

if (require.main === module) {
  if (process.env.PONYTAIL_MODE === 'off') process.exit(0);
  try {
    const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'ponytail', 'SKILL.md'), 'utf8');
    // SessionStart stdout is added to Claude's context; drop the frontmatter.
    console.log(offTopicRemoved(skill.replace(/^---[\s\S]*?\n---\s*/, '')));
  } catch {
    // Missing skill must not break session start.
  }
} else {
  module.exports = { offTopicRemoved };
}
