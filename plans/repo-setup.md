# repo-setup: set a repo up for Claude Code

## Goal
A skill, `/repo-setup`, that brings a repo's Claude Code files in line with
Anthropic's guidance on where instructions belong. In a repo without a
`CLAUDE.md` it runs the built-in `/init`. In a repo with one it proposes
which instructions to move out of `CLAUDE.md` into rules, skills, hooks or
permissions, backs up, and applies what the user picks.

## Decisions
- D1 Separate skill next to `agentic-kit-setup`, which runs it as its last
  step with `--no-questions` (D9). Run on its own, it points to
  `/agentic-kit-setup` at the end.
- D2 Propose, back up, then apply only the findings the user picked.
- D3 The baseline is bundled (`skills/repo-setup/baseline.md`), not fetched
  at run time. Official Anthropic sources only:
  the "Steering Claude Code" blog post, the memory docs page and the
  "Extend Claude Code" docs page.
- D4 The analysis covers `CLAUDE.md`, `CLAUDE.local.md`, nested `CLAUDE.md`
  files, `AGENTS.md` and the project's `.claude/` (rules, skills, commands,
  agents, and `hooks` / `permissions` in `settings.json`). Not `~/.claude`.
- D5 The user chooses the backup folder; default `./.repo-setup-backup`.
  They confirm the backup before the first change.
- D6 Backup copies get a `.bak` suffix, so Claude Code doesn't load a
  backed-up `CLAUDE.md` or rule as live instructions. The backup folder
  ignores itself in git.
- D7 `/init` is started through the Skill tool. If that doesn't work, the
  skill tells the user to type `/init`; it never writes its own version.
- D8 Hooks are drafted only when the command is already known from the
  repo. Other hook findings stay recommendations.
- D9 With `--no-questions` the skill asks nothing: all findings are picked,
  and the backup goes to `./.repo-setup-backup` without a confirmation.
  `agentic-kit-setup` backs up with the same script before its own changes,
  so there are two backups next to each other: the first restores the repo
  as it was, the second undoes only the restructuring.
- D10 The skill leaves the "Invent Project Guidelines" section of
  `CLAUDE.md` alone. Otherwise it would move the workflow into a skill
  (P-13) and `agentic-kit-setup` would add it again.
- D11 `agentic-kit-setup` runs `/init` (or creates the `@AGENTS.md` import)
  before it adds the Invent block to a repo without a `CLAUDE.md`. By the
  time `repo-setup` runs, a `CLAUDE.md` exists, so it would not run `/init`.
- D12 A finding's text is removed from its old place only after the write
  to the new place has succeeded. A refused or declined write leaves the old
  text and is reported as not applied.
- D13 The Invent block leaves out the pre-commit part in repos where
  `agentic-kit-setup` sets up no pre-commit hooks. `.py` files anywhere in
  the repo make it a Python project, not only at the root.
- D14 `protect-secrets` lets a quoted regex such as `grep -v '\.env'` pass:
  inside quotes `\.env` is never the file `.env`. Unquoted, `\.env` is the
  file and is blocked.

## Acceptance criteria
- [x] AC1 `backup.js save` copies the files into `<folder>/<timestamp>/`
      with their relative paths and a `.bak` suffix, and `restore` brings
      changed and deleted files back. Test: `backup.test.js` "copies the
      files…", "brings changed and deleted files back".
- [x] AC2 The backup holds no `.md` file and ignores itself in git. Test:
      "leaves no file Claude Code would load…", "keeps the backup out of git".
- [x] AC3 The backup folder can be outside the repo. Test: "accepts a
      folder outside the repo".
- [x] AC4 Missing files, files outside the repo and an empty list are
      refused before anything is copied. Test: "refuses missing files…".
- [x] AC5 `agentic-kit-setup` can start the skill, the script it runs is
      pre-approved and exists, and edits are not pre-approved. Test:
      `skill.test.js` "SKILL.md".
- [x] AC6 Every baseline rule has a source, and every link goes to
      `claude.com`, `code.claude.com` or `www.anthropic.com`. Test:
      `skill.test.js` "baseline.md".
- [x] AC7 Empty repo: `/repo-setup` starts `/init`, or tells the user to.
      Headless run, 2026-10-04.
- [x] AC8 Repo with only `AGENTS.md`: proposes a `CLAUDE.md` with
      `@AGENTS.md`. Headless run, 2026-10-04.
- [ ] AC9 Repo with an overgrown `CLAUDE.md` (deploy procedure, API-only
      rule, "never edit .env", a personal preference): four findings, the
      backup confirmed before the first write, the picked findings applied.
      Manual run. Headless run on 2026-10-04 produced the findings and
      stopped at the question; backup and apply still need an interactive run.
- [x] AC10 `agentic-kit-setup` backs up with the pre-approved `backup.js`
      and starts `repo-setup` with `--no-questions`. Test: `skill.test.js`
      "agentic-kit-setup".
- [ ] AC11 `/agentic-kit-setup` on the repo from AC9: two timestamped
      folders in `.repo-setup-backup`, no question from `repo-setup`, the
      Invent block untouched; the second restore command undoes only the
      restructuring, the first brings back the original files. Manual run.
- [ ] AC12 `/agentic-kit-setup` in a repo without a `CLAUDE.md`: `/init`
      runs before the Invent block is added. Manual run.
- [x] AC13 `grep -v '/\.env'` as a filter is allowed; `grep KEY \.env` and a
      filter that also names `.env` as a file are blocked. Test:
      `protect-secrets.test.js` "grep-env bash pattern",
      `invent-patches.test.js` "a quoted regex is not the .env file".
- [x] AC14 `/repo-setup` with a refused write: the old text is never
      removed, and the finding is reported as not applied. Headless run on
      `test-repo-setup/overgrown`, 2026-10-04.
- [x] AC15 `/agentic-kit-setup` in a Node repo: no pre-commit bullet in the
      Invent block. In a repo whose only `.py` file is under `src/`: Step 5
      applies. Headless runs on `test-agentic_kit/agents-only` and `empty`,
      2026-10-04.

## Out of scope
- Web research at run time, and changes under `~/.claude`.
- Reviewing the quality of skills and hooks beyond where instructions live.
- Writing Invent's guidelines block, secret-file rules and pre-commit
  checks (`/agentic-kit-setup` does that before it starts this skill).
- Plugins, MCP servers, output styles.
