---
name: agentic-kit-setup
description: Walk the user through onboarding their personal and project CLAUDE.md files with Invent's agentic-coding guidelines and workflow, the project's secret-file deny rules, its pre-commit quality gate, and an optional personal statusline and notification. Use when the user runs /agentic-kit-setup or asks to set up Invent's Claude Code conventions.
---

Walk the user through this step by step, one question at a time via AskUserQuestion.
Never silently rewrite a file — always show the exact block you intend to
insert and ask the user for explicit confirmation before writing it.

## Step 1 — Personal CLAUDE.md (~/.claude/CLAUDE.md)

1. Check whether `~/.claude/CLAUDE.md` exists.
   - If missing: ask the user whether to create it with Karpathy's four
     guidelines below.
   - If it exists: read it and use your judgment to check whether it already
     covers the four guidelines (Think Before Coding, Simplicity First,
     Surgical Changes, Goal-Driven Execution) — wording may differ, match on
     substance, not exact headers. This is a one-time setup step, so it's
     fine to read the whole file.
     - If all four are covered: tell the user this is already set up, move
       to Step 2.
     - If missing/partial: show the missing block and ask whether to append it.

Guideline block to insert if needed:

    ## 1. Think Before Coding
    State assumptions explicitly. If uncertain, ask. If multiple interpretations
    exist, present them. Push back on unneeded complexity.

    ## 2. Simplicity First
    Minimum code that solves the problem. No speculative abstractions or
    unrequested flexibility.

    ## 3. Surgical Changes
    Touch only what you must. Don't refactor or "improve" adjacent code.
    Match existing style.

    ## 4. Goal-Driven Execution
    Turn tasks into verifiable success criteria before looping on them.

## Step 2 — Project CLAUDE.md (./CLAUDE.md)

1. Check whether `./CLAUDE.md` exists in the current project.
   - If missing: ask whether to create it with the Invent baseline below.
   - If it exists: read it and use your judgment to check whether it already
     has an "Invent Project Guidelines" section (substance, not exact title).
     - If present and marked v0.2: tell the user it's already set up, move
       to Step 3.
     - If present but older (v0.1 or unversioned): show the diff to the
       block below and ask whether to replace the old section with it.
     - If missing: show the block below and ask whether to append it.

Invent baseline block (v0.2):

    ## Invent Project Guidelines (v0.2)

    Suggested workflow for bigger changes or tickets. It is not enforced;
    small, low-risk changes don't need it. It pays off most in code you don't
    know yet.

    1. **Grill it** — run `/grill-with-docs` to stress-test the approach
       against the code and existing docs. Put each round of questions into
       AskUserQuestion (max 4 per call, recommended answer as first option).
    2. **Plan it** — create the feature branch, then write the plan to
       `plans/<branch name without prefix>.md` (`feature/PROJ-123-login` →
       `plans/PROJ-123-login.md`) using the template below. Every acceptance
       criterion names the test or command that proves it. Then apply
       `ponytail` to the plan to strip it to the simplest version that meets
       the criteria.
    3. **Approve it** — point the user to the plan file and wait for their
       approval before writing code. They may edit the file directly.
    4. **Implement it** — on the feature branch, never on main/master.
       Delegate to subagents capped at Sonnet (no higher-tier model per
       subagent); tell each one to read the plan file, which step to
       implement, and to follow this CLAUDE.md and the `ponytail` skill.
    5. **Verify it** — run the test for every acceptance criterion and the
       pre-commit hooks; fix until green. Tick each criterion in the plan
       file once its test passes.
    6. **Review it** — run the `pr-review` agent on the branch; it reads the
       plan file itself. Address its findings before opening the PR.

    Commit the plan file with the change, so reviewers see what was asked.

    Plan template:

        # <ticket id> <title>

        ## Goal
        One sentence: what and why.

        ## Acceptance criteria
        - [ ] <observable behaviour> — Test: <test name or command>

        ## Steps
        1. ...

        ## Out of scope
        - ...

    ### Invent tooling (v0.2)

    - **Pre-tool-use hooks (active):** `protect-secrets` (Read/Edit/Write/Grep/
      Bash/PowerShell), `block-dangerous-commands` and `git-safety`
      (Bash/PowerShell). `git-safety` blocks commits, merges, resets and
      pushes on main/master — work on a feature branch.
    - **Session-start hook (active):** loads the `ponytail` ruleset into every
      session.
    - **Deny rules:** `.claude/settings.json` blocks reading and editing
      secret files (`.env`, keys, credentials). Don't work around them.
    - **Pre-commit hooks:** Python complexity (radon/xenon), lint and format
      (ruff), optional type check (ty) — blocking in prod repos, advisory in
      demo repos; see `.pre-commit-config.yaml`. Never bypass them with
      `--no-verify`: if a hook blocks, fix the reported issue once; if it
      still fails, stop and ask the user.
    - **Testing guidelines:** none yet — TBD.

    If the user asks what Invent's hooks/pre-commit/testing setup is, report
    exactly the state above — don't invent details beyond what's listed.

## Step 3 — Deny rules for secret files (./.claude/settings.json)

Claude Code's own permission rules stop Claude's file tools, and file commands
like `cat` in Bash, from touching these paths — on every OS, before any hook
runs. Project settings are committed, so they protect everyone on the team.

1. Check whether `./.claude/settings.json` exists.
   - If missing: show the block below and ask whether to create the file
     with it.
   - If it exists: read it. Show which of the rules below are missing from
     `permissions.deny` and ask whether to add them. Keep every existing key
     and rule; never remove or reorder the user's rules.
2. Remind the user to commit `.claude/settings.json`.

Rules (bare names match at any depth in the project; a `!` rule carves an
exception out of the rules listed before it, so keep the order):

    {
      "permissions": {
        "deny": [
          "Read(.env)",
          "Read(.env.*)",
          "Read(!.env.example)",
          "Read(!.env.sample)",
          "Read(!.env.template)",
          "Edit(.env)",
          "Edit(.env.*)",
          "Edit(!.env.example)",
          "Edit(!.env.sample)",
          "Edit(!.env.template)",
          "Read(.envrc)",
          "Read(*.pem)",
          "Read(*.key)",
          "Read(*.p12)",
          "Read(*.pfx)",
          "Read(credentials.json)",
          "Read(secrets.json)",
          "Read(secrets.yaml)",
          "Read(secrets.yml)",
          "Read(secrets.toml)",
          "Read(~/.ssh/**)",
          "Read(~/.aws/**)"
        ]
      }
    }

## Step 4 — Pre-commit hooks (project)

Only applies to Python projects in a git repository (a `pyproject.toml`, a
`uv.lock`/`poetry.lock`, or `.py` files at the repo root). Otherwise say so
and skip to Step 5.

1. Detect the environment manager:
   - `uv.lock` present → `uv`.
   - `poetry.lock` present (or `[tool.poetry]` in `pyproject.toml`) → `poetry`.
   - Otherwise → treat as a plain venv/pip project.
2. Ask via AskUserQuestion: **"Is this a demo or a prod repo?"**
   - **Demo** — one-off demo, spike or prototype. Checks are *advisory*:
     findings are listed on every commit, but the commit goes through. The
     one exception is `ruff format`: when it reformats a file, the commit
     stops once — `git add` and commit again.
   - **Prod** — code that will be maintained. Checks are *blocking*: a commit
     fails on any function of rank D or worse (complexity ≥ 21; rank C,
     11–20, is still listed as a warning), on any `ruff` lint finding, and —
     if chosen below — on any `ty` type error.
3. Ask via AskUserQuestion whether to add **ty**, a fast type checker
   (recommended for new code). It runs from the project's venv so it can see
   the project's dependencies, so it must be a dev dependency. Check whether
   it's installed (`uv run ty --version`, `poetry run ty --version`, or
   `ty --version` in the active venv); if not, show the exact command
   (`uv add --dev ty`, `poetry add --group dev ty`, or `pip install ty`) and
   ask for confirmation before running it. If they decline, leave it out.
4. Check whether `.pre-commit-config.yaml` exists.
   - If missing: show the blocks for the chosen mode (below), prefixed with a
     top-level `repos:` line, and ask to create the file.
   - If it exists: read it. If it already has a `radon-cc`, `xenon`, `ruff`,
     `ruff-check`, `ruff-format`, `ty` or `pylint` hook, tell the user and
     ask whether to replace it. Otherwise show the blocks and ask whether to
     append them under the existing `repos:` list.
5. Check whether `pre-commit` is available (`pre-commit --version`, or
   `uv run pre-commit --version` / `poetry run pre-commit --version`). If not,
   **never install it silently** — show the exact command for their
   environment (e.g. `uv add --dev pre-commit`, `poetry add --group dev
   pre-commit`, or `pip install pre-commit`) and ask for confirmation first.
6. Run `pre-commit install` so the hooks fire on `git commit`, then
   `pre-commit run --all-files` once and show the user the result, so they
   see the current state of the codebase. In prod mode on an existing
   codebase this may already fail — tell the user what fails and that they
   can either fix it or loosen the threshold (see the comments in the
   blocks); don't fix it yourself here.

radon, xenon and ruff are installed by pre-commit itself in isolated
environments — nothing to add to the project. `ty` runs from the project
venv: the block below uses `uv run`; use `poetry run` for poetry, and drop
the prefix for a plain venv (the venv must be active when committing).

Demo block (advisory):

      - repo: https://github.com/astral-sh/ruff-pre-commit
        rev: v0.16.9
        hooks:
          # Advisory: lists lint findings, never blocks. Rules: ruff's defaults;
          # add more under [tool.ruff.lint] in pyproject.toml. Leave C901 off,
          # radon covers complexity.
          - id: ruff-check
            args: [--exit-zero]
            verbose: true
          # Formats Python files. Stops the commit once when it changes a file.
          - id: ruff-format
            types_or: [python, pyi]
      - repo: local
        hooks:
          # Advisory only: lists functions of rank C or worse (complexity >= 11),
          # never blocks. Raise to D to see less, lower to B to see more.
          # Ranks: A 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41+.
          - id: radon-cc
            name: radon-cc (complexity, advisory)
            entry: radon cc --min C --show-complexity
            language: python
            additional_dependencies: [radon==6.0.1]
            types: [python]
            verbose: true
            exclude: ^(tests/|scripts/)

Prod block (blocking):

      - repo: https://github.com/astral-sh/ruff-pre-commit
        rev: v0.16.9
        hooks:
          # Blocking: fails on any lint finding. Rules: ruff's defaults; add
          # more under [tool.ruff.lint] in pyproject.toml. Leave C901 off,
          # radon/xenon cover complexity.
          - id: ruff-check
          # Formats Python files. Stops the commit once when it changes a file.
          - id: ruff-format
            types_or: [python, pyi]
      - repo: local
        hooks:
          # Advisory: lists functions of rank C or worse (complexity >= 11).
          # Ranks: A 1-5, B 6-10, C 11-20, D 21-30, E 31-40, F 41+.
          - id: radon-cc
            name: radon-cc (complexity, advisory)
            entry: radon cc --min C --show-complexity
            language: python
            additional_dependencies: [radon==6.0.1]
            types: [python]
            verbose: true
            exclude: ^(tests/|scripts/)
          # Blocking: fails the commit if any function is worse than rank C,
          # i.e. D or worse (complexity >= 21). Use --max-absolute B for a
          # stricter gate (fails at 11+); avoid A, it flags ordinary code.
          - id: xenon
            name: xenon (complexity gate, blocking)
            entry: xenon --max-absolute C
            language: python
            additional_dependencies: [xenon==0.9.3]
            types: [python]
            exclude: ^(tests/|scripts/)

Optional ty block (append to the `repo: local` hooks if the user chose it):

          # Type checking from the project venv, so project imports resolve.
          # Prod: blocks on any type error.
          # Demo: use `uv run ty check --exit-zero` and add `verbose: true`.
          - id: ty
            name: ty (type check)
            entry: uv run ty check
            language: system
            types: [python]
            exclude: ^(tests/|scripts/)

To switch a repo from demo to prod later, rerun this step, or edit the hooks
by hand (add `xenon`, drop the `--exit-zero` flags).

## Step 5 — Statusline and notification (personal, optional)

Both are personal preferences, so they go into the user's own
`~/.claude/settings.json`, not the project. Ask via AskUserQuestion
(multiSelect) which to set up; skip this step if they pick neither:

- **Statusline** — two lines under the prompt:
  `[Opus]  effort:medium  ctx:23%/1000k  $0.41  today:~$12.34  +120/-45  5h:37%`
  and `(main*)  ~/code/my-repo`. `today:~$` is an estimate at API list prices,
  not the bill on a subscription; `5h` only shows on Pro/Max subscriptions.
- **Notification** — a desktop notification "Claude finished in <project> -
  your turn" whenever Claude stops. Useful with several sessions in parallel;
  noisy if you watch Claude work anyway.

1. Copy the chosen scripts from `${CLAUDE_PLUGIN_ROOT}/extras/` (`statusline.js`,
   `notify.js`) to `~/.claude/invent-kit/`, overwriting older copies from this
   kit. They are copied because the plugin folder moves on every update.
2. Read `~/.claude/settings.json` (create it with `{}` if missing) and show the
   exact change before writing it. Use the absolute home path with forward
   slashes (`C:/Users/<you>/...` on Windows), since the command may run in Git
   Bash, which drops backslashes.
   - **Statusline:** set
     `"statusLine": { "type": "command", "command": "node <home>/.claude/invent-kit/statusline.js" }`.
     If a different `statusLine` is already set, show it and ask before replacing it.
   - **Notification:** add to `hooks.Stop` (keep every existing hook, don't
     add it twice):
     `{ "hooks": [ { "type": "command", "command": "node <home>/.claude/invent-kit/notify.js" } ] }`.
3. Tell the user it takes effect after restarting Claude Code. On Windows, the
   first notification may need notifications for "Windows PowerShell" allowed
   under Settings → System → Notifications; on macOS, for "Script Editor".
   Linux needs `notify-send` (package `libnotify-bin`).

## Step 6 — Done

Confirm all files are in the desired state and summarize what changed.
