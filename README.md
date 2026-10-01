# invent-agentic-kit

A Claude Code plugin that gives Invent projects a shared way of building with
Claude: one guided setup, safety hooks and secret-file rules that apply
automatically, pre-commit quality checks sized to the repo, a suggested workflow for bigger
tickets, and a review agent that checks the result against the ticket.

## What it does

### 1. Guided setup — `/agentic-kit-setup`

Run it once per project. It asks before every change and never rewrites a
file silently:

1. **Personal CLAUDE.md** (`~/.claude/CLAUDE.md`) — checks for four core
   coding guidelines (think before coding, simplicity first, surgical changes,
   goal-driven execution) and offers to add any that are missing.
2. **Project CLAUDE.md** — adds the Invent project guidelines: the ticket
   workflow below and a summary of the hooks in use. Updates an older
   version of the block if it finds one.
3. **Deny rules** (`.claude/settings.json`, committed) — Claude Code's own
   permission rules block reading and editing `.env` files, keys and
   credentials for everyone on the team (see below). Also checks that
   `.env` files are in `.gitignore` and offers to add them.
4. **Pre-commit hooks** — asks whether this is a **demo** or a **prod** repo
   and sets up the pre-commit checks to match (see below).
5. **Statusline and notification** *(optional, personal)* — a two-line
   statusline and a desktop notification when Claude finishes, written into
   your own `~/.claude/settings.json`.

Step 4 only runs for Python projects in a git repo. The pre-commit checks
cover Python files only; there are no checks for JS/TS or other languages
(Prettier, ESLint, …) yet.

**Statusline and notification.** Step 5 copies `extras/statusline.js` and
`extras/notify.js` to `~/.claude/invent-kit/` and points your personal
settings at them. Both are Node scripts, so they run on Windows, macOS and
Linux without extra tools.

```
[Opus]  effort:medium  ctx:23%/1000k  $0.4123  today:~$12.34  +120/-45  5h:37%
(main*)  ~/code/my-repo
```

- `ctx`: context used (cyan < 50 %, yellow ≥ 50 %, red ≥ 80 %)
- `$…`: this session's cost as Claude Code reports it
- `today:~$`: estimated spend across all of today's sessions and subagents, at
  API list prices (as of 2026-09-25). Not your bill on a subscription. Update
  the `PRICES` table in the script when prices change.
- `+/-`: lines added/removed; `5h`: 5-hour rate-limit use (Pro/Max only)
- git branch (`*` = uncommitted changes) and working directory

The notification reads "Claude finished in <project> - your turn", so
parallel sessions stay apart.

### 2. Guards: hooks, deny rules and pre-commit

**Claude Code hooks** come with the plugin and are active as soon as it is
installed. They run while Claude works, on Claude's own tool calls:

| Hook | When | What it does |
|---|---|---|
| `protect-secrets` | before Read/Edit/Write/Grep/Bash/PowerShell | Blocks reading, editing or leaking `.env` files, keys and credentials |
| `block-dangerous-commands` | before Bash/PowerShell | Blocks destructive commands (`rm -rf ~`, `Remove-Item -Recurse ~`, force-push to main, `git reset --hard`, …) |
| `git-safety` | before Bash/PowerShell | No commits, merges, resets or pushes on main/master; no `gh pr merge`, `gh repo delete`, … |
| `ponytail-activate` | session start | Loads the `ponytail` ruleset into every session (off: `PONYTAIL_MODE=off`) |

The safety hooks can be tuned with the `HOOK_SAFETY_LEVEL` environment
variable (`critical` / `high` / `strict`, default `high`). All hooks log to
`~/.claude/hooks-logs/`. They are regex guards — a seatbelt against slips,
not a sandbox.

The three safety hooks come from
[karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks).
Our changes are marked `invent patch:` in the scripts and covered by
`hooks/tests/invent-patches.test.js`:

- `protect-secrets` blocks Windows paths (`C:\proj\.env` slipped through), no
  longer lets a whole command through because it ends in `.env.example`, and
  also checks Grep and the PowerShell tool.
- `block-dangerous-commands` and `git-safety` also check the PowerShell tool;
  `block-dangerous-commands` knows `Remove-Item`/`Format-Volume`.
- `git-safety` only treats `main`/`master` as protected when it is the whole
  ref, so `git push origin feature/main-page` is allowed.
- All three no longer crash (and so fail open) when `HOME` is unset.

Run the tests with `node --test "hooks/**/*.test.js" "extras/**/*.test.js"` (Node ≥ 21).

**Deny rules** are written into the project's `.claude/settings.json` by
setup step 3. Claude Code enforces them itself, before any hook runs and on
every OS: Claude's file tools, Grep, and file commands like `cat` in Bash
can't read or edit `.env`/`.env.*` (except `.env.example`, `.sample`,
`.template`), `*.pem`, `*.key`, `credentials.json`, `secrets.*`,
`~/.ssh` and `~/.aws`. A script that opens files itself (`python -c ...`)
is not covered — that needs Claude Code's sandbox.

**Pre-commit hooks** are written into the project's `.pre-commit-config.yaml`
by setup step 4. They run on every `git commit`, whoever makes the commit —
Claude or a person. They check **Python files only**: a commit without `.py`
files passes them untouched, and other languages (JS/TS, …) aren't checked yet.

| Hook | Demo repo | Prod repo | Runs from |
|---|---|---|---|
| `radon-cc` — cyclomatic complexity | Lists functions with complexity ≥ 11 | Same | pre-commit's own environment |
| `xenon` — complexity gate | — | Blocks functions with complexity ≥ 21 | pre-commit's own environment |
| `ruff-check` — lint | Lists findings | Blocks on findings | pre-commit's own environment |
| `ruff-format` — formatting | Formats | Formats | pre-commit's own environment |
| `ty` — type checker *(optional)* | Lists type errors | Blocks on type errors | project venv (dev dependency), via `uv run --no-sync` so commits never rewrite `uv.lock` |

Demo repos get advisory checks: findings are shown, but the commit goes
through, so a one-off demo isn't slowed down. The one exception is
`ruff-format`: when it reformats a file, the commit stops once — add the file
and commit again. Prod repos get blocking checks. The thresholds and how to
change them are explained in comments in the generated
`.pre-commit-config.yaml`. `ty` is only added if you choose it during setup,
because it must be installed in the project's venv to see its dependencies.

Each tool has one job: radon/xenon measure complexity, ruff lints and
formats, ty checks types. ruff's own complexity rule (C901) stays off so
complexity isn't checked twice.

### 3. A workflow for bigger tickets — suggested, not required

Setup adds this loop to the project CLAUDE.md as the suggested way to handle
bigger tickets. Nothing enforces it.

It pays off most when you don't know the codebase yet: the grilling step makes
Claude dig through the code and docs and ask you questions, which is a fast way
to understand how things fit together before anything changes.

If you already know what you want to do and where, skip the loop: tell Claude
your plan directly — `ponytail` is active anyway. Smaller changes don't need a
long grilling session.

1. **Grill it** — `/grill-with-docs` stress-tests the approach and writes
   resolved terms to `GLOSSARY.md` and decisions to ADRs as you go.
2. **Plan it** — Claude writes `plans/<branch>.md`: goal, acceptance criteria
   (each with the test that proves it), steps, out of scope — stripped to
   the simplest version with `ponytail`.
3. **Approve it** — you read (and may edit) the plan file before any code is
   written.
4. **Implement it** — on a feature branch; subagents capped at Sonnet, each
   reading the plan file.
5. **Verify it** — tests for every acceptance criterion and pre-commit green;
   criteria get ticked in the plan file.
6. **Review it** — the `pr-review` agent reads the plan file and checks the
   branch against it before the PR. It runs on Opus; the Sonnet cap is for
   implementation subagents only.

The plan file is committed with the change, so human reviewers see the
criteria too. It is also the hook for a later Jira connector: the ticket
fills goal and criteria, everything else stays the same.

### 4. Skills and agent

| | Use |
|---|---|
| `/agentic-kit-setup` | The guided setup above |
| `/grill-with-docs` | Grilling plus domain modeling: interview, glossary and ADRs in one go |
| `/grilling` | The interview alone, without docs, in rounds of numbered questions with recommended answers |
| `domain-modeling` | Writes `GLOSSARY.md` and ADRs; loaded by `grill-with-docs` |
| `ponytail` | Simplest solution that works; active every session via the hook above |
| `pr-review` agent | Read-only review: acceptance criteria from `plans/<branch>.md` → implementation, then correctness, then simplicity (ponytail lens). Runs on Opus. |

`grilling`, `grill-with-docs` and `domain-modeling` are from
[mattpocock/skills](https://github.com/mattpocock/skills), `ponytail` from
[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) —
unchanged, so they can be updated by copying the upstream files again.

## Setup

In Claude Code, add the kit as a plugin marketplace and install it — from a
local copy or from the git repo:

```
/plugin marketplace add <path to this folder or git URL>
/plugin install invent-agentic-kit@invent-agentic-kit
```

Restart Claude Code, open your project, and run `/agentic-kit-setup`.

To update: `/plugin marketplace update invent-agentic-kit`, then restart.
To see or disable the hooks: `/hooks`, or turn the plugin off in `/plugin`.

### Requirements

- **Node.js ≥ 18** — all Claude Code hooks are Node scripts.
- **git** — for `git-safety` and the pre-commit hooks.
- **Python projects:** a project venv managed by `uv`, `poetry` or pip, plus
  `pre-commit`. Setup offers to install `pre-commit` and `ty` if they're
  missing.
