---
name: repo-setup
description: Sets up a repo for Claude Code. Runs /init when the repo has no CLAUDE.md, otherwise analyses CLAUDE.md and .claude/ against official Anthropic guidance, proposes which instructions to move into rules, skills, hooks or permissions, backs the files up and applies what the user picks. Use when the user runs /repo-setup or asks to set up or restructure a repo's Claude Code files.
argument-hint: "[--no-questions]"
# CLAUDE_SKILL_DIR, not CLAUDE_PLUGIN_ROOT: the skill also runs as a plain symlinked skill, outside the plugin.
# Edit and Write are left out on purpose: Claude Code asks before each change.
# Any path to backup.js: the skill path may contain a space and get quoted, and on Windows Claude may run it via PowerShell.
allowed-tools: Bash(node *repo-setup/scripts/backup.js*) PowerShell(node *repo-setup/scripts/backup.js*) Read Glob Grep Skill(init)
---

Set up the repo in the current directory, step by step. Ask one question at
a time via AskUserQuestion. Change nothing before Step 6, and nothing that
was not picked.

Rules for the whole run:

- Work on this repo only. Never change files under `~/.claude`.
- Never read `.claude/settings.local.json`, `.mcp.json` or `.env` files.
- Never suggest installing a plugin.
- The baseline is [baseline.md](baseline.md). Don't research the web.

Arguments: $ARGUMENTS

With `--no-questions` (`/agentic-kit-setup` passes it), ask nothing: don't
use AskUserQuestion, and where a step says to ask, do what it says for this
case.

## Step 1 — Look at what is there

Find, with Glob:

- `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`
- `CLAUDE.md` files in subdirectories
- `.claude/rules/**/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/**/*.md`, `.claude/agents/*.md`
- `.claude/settings.json`

Skip `node_modules`, `.git`, `.claude/worktrees` and `.repo-setup-backup`.

- Neither `CLAUDE.md` nor `.claude/CLAUDE.md` exists: go to Step 2.
- Otherwise: go to Step 3.

## Step 2 — No CLAUDE.md yet

1. If `AGENTS.md` exists, don't run `/init`. Show this file and ask whether
   to create it as `./CLAUDE.md` (baseline P-05), then go to Step 7. With
   `--no-questions`, create it:

       @AGENTS.md

2. Otherwise tell the user you are starting the built-in `/init`, and invoke
   the `init` skill with the Skill tool.
3. If the Skill tool can't run it, don't write a `CLAUDE.md` yourself. Tell
   the user to type `/init` and to run `/repo-setup` again afterwards, and stop.
4. After `/init`, go to Step 7. Mention there that starting Claude Code with
   `CLAUDE_CODE_NEW_INIT=1` makes `/init` also offer skills and hooks.

## Step 3 — Analyse

Read [baseline.md](baseline.md), then every file from Step 1. In
`.claude/settings.json` look only at `hooks` and `permissions`.

Go through `CLAUDE.md` section by section, then the other files, and note a
finding wherever the baseline says the content belongs somewhere else:

| What you find | Where it belongs | Rule |
|---|---|---|
| A fact every session needs | stays in `CLAUDE.md` | P-01 |
| Vague, contradictory, duplicated or outdated text | reword or delete | P-03, P-04 |
| An instruction for some files only | `.claude/rules/<topic>.md` with `paths:` | P-10 |
| A rule without `paths:` that names specific files | add `paths:` | P-11 |
| Conventions of one subdirectory | `CLAUDE.md` in that subdirectory | P-12 |
| A multi-step procedure or reference material | `.claude/skills/<name>/SKILL.md` | P-13 |
| "Every time X, do Y" that must be reliable | hook in `.claude/settings.json` | P-14 |
| "Never do X" that must hold | `permissions.deny` in `.claude/settings.json` | P-15 |
| A personal preference | `CLAUDE.local.md`, listed in `.gitignore` | P-16 |
| `AGENTS.md` repeated in `CLAUDE.md` | `@AGENTS.md` import | P-05 |
| `AGENTS.md` next to a `CLAUDE.md` without `@AGENTS.md` (Claude doesn't read it) | `@AGENTS.md` import | P-05 |
| A rule, skill or subagent file in the wrong shape | fix the file | P-20 to P-23 |
| A file in `.claude/commands/` | a skill with the same name | P-13 |

A `CLAUDE.md` over 200 lines (P-02) is not a finding of its own: say how
many lines it has and how many remain after the findings above.

Leave alone what already follows the baseline. Also leave alone the
"Invent Project Guidelines" section of `CLAUDE.md`, up to the end of its
"Invent tooling" part: `/agentic-kit-setup` manages it, so raise no finding
on it. If nothing needs to change, say so and go to Step 7.

## Step 4 — Propose

Show a numbered list. For each finding:

- what it is, with file and lines
- where it goes, and the baseline rule with its source link
- the exact content you would write, and what you would remove

For a hook, draft it only when the command is already known from the repo
(a formatter or linter it uses, a command to block). Otherwise list the
finding as a recommendation without a draft and don't apply it.

Then ask which findings to apply: **all**, **let me pick** (the user gives
the numbers) or **none**. On none, go to Step 7. With `--no-questions`,
all findings are picked.

## Step 5 — Back up

1. Ask where the backup should go. Offer `./.repo-setup-backup` as the
   default; the user can name any other folder.
2. Back up every existing file the picked findings will change:

       node "${CLAUDE_SKILL_DIR}/scripts/backup.js" save <folder> <file> <file> ...

   The script creates a timestamped subfolder, stores each copy with a
   `.bak` suffix so Claude Code doesn't load it as an instruction file, and
   keeps the folder out of git.
3. Show the script's output and ask the user to confirm that the backup is
   there. Don't go on before they confirm. If the script fails, stop.

With `--no-questions`, use `./.repo-setup-backup` and go on once the script
has succeeded. An earlier backup in that folder stays next to the new one.

## Step 6 — Apply

Apply the picked findings one at a time:

- Write the new place first, in a call of its own. Remove the text from the
  old place only after that write has succeeded.
- If a write is refused or declined, leave the old text where it is, go on
  with the next finding, and report this one in Step 7 as not applied.
- Move text as it is. Reword only where the finding is about wording.
- New skills get `name` and `description` frontmatter; new rules get
  `paths:`. The shapes are at the end of [baseline.md](baseline.md).
- In `.claude/settings.json`, add to the existing `hooks` and
  `permissions.deny` entries; keep everything else as it is.
- When adding `CLAUDE.local.md`, also add it to `.gitignore`.

## Step 7 — Wrap up

Tell the user:

- which files were created and changed, and the new line count of `CLAUDE.md`
- to run `/context` in a new session and check the files under Memory files
- the restore command the backup script printed, and that the backup folder
  can be deleted once they are happy
- any finding that was listed without a draft
- any finding that was not applied, and why
- that `/agentic-kit-setup` adds Invent's guidelines, secret-file rules and
  pre-commit checks, if the repo doesn't have them yet (not with
  `--no-questions`)
