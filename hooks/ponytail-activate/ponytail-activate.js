#!/usr/bin/env node
/**
 * Ponytail Activate - SessionStart hook
 * Injects the ponytail ruleset into every session. Installed passively, the
 * skill never self-activates (JetBrains test, 2026-07), so we load it up front.
 * Slim replacement for upstream's activation hooks (no statusline, no mode
 * tracking). Set PONYTAIL_MODE=off to disable.
 */

const fs = require('fs');
const path = require('path');

if (process.env.PONYTAIL_MODE === 'off') process.exit(0);

try {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'ponytail', 'SKILL.md'), 'utf8');
  // SessionStart stdout is added to Claude's context; drop the frontmatter.
  console.log(skill.replace(/^---[\s\S]*?\n---\s*/, ''));
} catch {
  // Missing skill must not break session start.
}
