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

if (process.env.PONYTAIL_MODE === 'off') process.exit(0);

// Parts of the upstream text that don't apply to every Invent session: a
// hardware aside and a pointer to another plugin. The skill file stays as
// upstream ships it; if upstream rewords them, they simply stay in.
const OFF_TOPIC = [
  /\n\nHardware is never the ideal[\s\S]*?(?=\n\n)/,
  / \(pair with Caveman for\s+terse prose\)/,
];

try {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'ponytail', 'SKILL.md'), 'utf8');
  // SessionStart stdout is added to Claude's context; drop the frontmatter.
  const text = OFF_TOPIC.reduce((t, re) => t.replace(re, ''), skill.replace(/^---[\s\S]*?\n---\s*/, ''));
  console.log(text);
} catch {
  // Missing skill must not break session start.
}
