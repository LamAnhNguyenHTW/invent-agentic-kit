# invent-agentic-kit

A Claude Code plugin that gives Invent projects a shared way of building with
Claude: one guided setup, safety hooks and secret-file rules that apply
automatically, pre-commit quality checks sized to the repo, a skill that
moves instructions out of an overgrown `CLAUDE.md` into rules, skills, hooks
or permissions, a suggested workflow for bigger tickets, and a review agent
that checks the result against the ticket.

## What it does

### 1. Guided setup — `/agentic-kit-setup`

Run it once per project. It first copies the repo's Claude Code files
(`CLAUDE.md`, `.claude/`, `.pre-commit-config.yaml`) to
`./.repo-setup-backup`. Then it asks before every change and never rewrites
a file silently, except in step 7:

1. **Personal CLAUDE.md** (`~/.claude/CLAUDE.md`) — checks for four core
   coding guidelines (think before coding, simplicity first, surgical changes,
   goal-driven execution) and offers to add any that are missing.
2. **Repo type** — asks whether this is a **demo** or a **prod** repo. The
   answer decides how strict `git-safety` and the pre-commit checks are (see
   below).
3. **Project CLAUDE.md** — adds the Invent project guidelines: the ticket
   workflow below and a summary of the hooks in use, worded for the repo
   type. Updates an older version of the block if it finds one. In a repo
   without a `CLAUDE.md` it starts Claude Code's built-in `/init` first; next
   to an `AGENTS.md` it imports it with `@AGENTS.md` instead (Claude Code
   stops reading `AGENTS.md` once a `CLAUDE.md` exists).
4. **Project settings** (`.claude/settings.json`, committed) — Claude Code's
   own permission rules block reading and editing `.env` files, keys and
   credentials for everyone on the team, and `INVENT_REPO_TYPE` records the
   repo type (see below). Also checks that `.env` files are in `.gitignore`
   and offers to add them.
5. **Pre-commit hooks** — sets up the pre-commit checks for the repo type
   (see below). Shows the current state of the code without changing any
   file; formatting the whole repo is a separate, optional step.
6. **Statusline and notification** *(optional, personal)* — a two-line
   statusline and a desktop notification when Claude finishes, written into
   your own `~/.claude/settings.json`.
7. **Restructure** — runs `/repo-setup` (see below) without questions: it
   lists what belongs outside `CLAUDE.md`, takes a second backup and applies
   all of it. The skill asks nothing; Claude Code may still ask you to
   allow each file change, depending on your permission mode. The Invent
   block stays as it is.
8. **Done** — summarizes the changes, gives both restore commands, and
   points to `/doctor` and `/doctor prompt-audit` for tidying up later.

**Backups.** Each of the two backups is a timestamped folder in
`./.repo-setup-backup`, kept out of git, and the setup prints a restore
command for each. The second one undoes only the restructuring; the first
one puts back every file that existed before the setup, as it was then.
Files the setup created, and changes to `.gitignore` and `~/.claude`, stay
in place. Step 7 never adds back what you declined earlier in the setup.

Step 5 only runs for Python projects in a git repo (`.py` files anywhere in
the repo count). The pre-commit checks cover Python files only; there are no
checks for JS/TS or other languages (Prettier, ESLint, …) yet. In other repos
the guidelines block from step 3 leaves the pre-commit part out.

**Statusline and notification.** Step 6 copies `extras/statusline.js` and
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
| `git-safety` | before Bash/PowerShell | Prod: no commits, merges, resets or pushes on main/master; no `gh pr merge`, `gh repo delete`, … Demo: relaxed (see below) |
| `ponytail-activate` | session start | Loads the `ponytail` ruleset into every session (off: `PONYTAIL_MODE=off`) |

The three pre-tool-use hooks log to `~/.claude/hooks-logs/`. They are regex
guards — a seatbelt against slips, not a sandbox.

**Demo vs prod.** `git-safety` reads the repo type from `INVENT_REPO_TYPE`,
which setup writes into the project's `.claude/settings.json`. Unset or any
other value means prod.

| | Prod | Demo |
|---|---|---|
| commit, merge, rebase, reset, push while on main/master | blocked | allowed |
| `git push origin main` from another branch | blocked | allowed |
| `gh pr merge`, `gh pr close`, `gh issue close` | blocked | allowed |
| deleting main/master, locally or on the remote (`git push origin --delete main`, `:main`) | blocked | blocked |
| force-pushing main/master (`--force`/`-f`/`--force-with-lease`, `+main`, or any force-push while on main) | blocked | blocked |
| `gh repo delete`, `gh release delete` | blocked | blocked |
| `git reset --hard`, `git clean -f` on any branch (`block-dangerous-commands`) | blocked | blocked |

Force-pushing a feature branch is allowed in both. In prod, `git reset` on
main is only blocked when it moves the branch (`--soft`/`--hard`/…,
`HEAD~1`, a commit); unstaging (`git reset HEAD file`) is fine.

**Configuration.** The hooks read environment variables. With a plugin you
can't edit the hook command, so set them under `"env"` in a settings file:
`.claude/settings.json` for the whole team, `.claude/settings.local.json` or
`~/.claude/settings.json` for yourself. Each hook reads them on every call,
so a saved change applies to the next tool call.

```json
{ "env": { "INVENT_REPO_TYPE": "demo", "HOOK_SAFETY_LEVEL": "strict" } }
```

| Variable | Values | Effect |
|---|---|---|
| `INVENT_REPO_TYPE` | `prod` (default) / `demo` | How strict `git-safety` is (table above) |
| `HOOK_SAFETY_LEVEL` | `critical` / `high` (default) / `strict` | How many rules the three safety hooks apply. `critical` turns `git-safety` off entirely |
| `HOOK_ASK_CRITICAL`, `HOOK_ASK_HIGH`, `HOOK_ASK_STRICT` | `true` | Ask instead of block for that level (protect-secrets, block-dangerous-commands) |
| `PONYTAIL_MODE` | `off` | Stops loading ponytail at session start. The skill stays installed, so Claude may still invoke it on its own |

`ponytail-activate` runs on startup, `/clear` and compaction, not on resume,
where the transcript already has it.

The three safety hooks come from
[karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks).
Our changes are marked `invent patch:` in the scripts and covered by
`hooks/tests/invent-patches.test.js`:

- `protect-secrets` blocks Windows paths (`C:\proj\.env` slipped through), no
  longer lets a whole command through because it ends in `.env.example`, and
  also checks Grep and the PowerShell tool.
- `protect-secrets` drops an allowlisted name only when it is a whole
  token, so `cat .env;.env.example` is still caught; expands Grep globs
  (`.env*`, `{.env,.env.local}`); treats `.ENV` as `.env`; lets a quoted
  regex like `grep -v '\.env'` pass; catches `gci env:` (PowerShell env dump).
- `block-dangerous-commands` and `git-safety` also check the PowerShell tool;
  `block-dangerous-commands` knows `Remove-Item`/`Format-Volume` and
  PowerShell deletes of `.`, `*` and a drive root.
- `block-dangerous-commands` and `git-safety` see through `git -C <dir>` /
  `git -c k=v` / `--no-pager`, so `git -C . reset --hard` is caught.
- `block-dangerous-commands` reads `rm` operands as whole tokens: upstream's
  rules backtracked for 40 s on long commands, past the hook timeout. It also
  catches `rm -rf ~/*`, `rm -rf "$HOME"/` and `(rm -rf *)`.
- `git-safety` only treats `main`/`master` as protected when it is the whole
  ref, so `git push origin feature/main-page` is allowed; reads the branch
  from the session's working directory (or the `git -C` one); has the
  demo/prod repo type above; catches `git branch --delete --force main`.
- All three no longer crash (and so fail open) when `HOME` is unset.

Run the tests with
`node --test "hooks/**/*.test.js" "extras/**/*.test.js" "skills/**/*.test.js"`
(Node ≥ 21).

**Deny rules** are written into the project's `.claude/settings.json` by
setup step 4. Claude Code enforces them itself, on every OS: Claude's file
tools (Read, Edit, Write, Grep, Glob) can't read or edit `.env`/`.env.*`
(except `.env.example`, `.sample`, `.template`), `*.pem`, `*.key`,
`credentials.json`, `secrets.*`, `~/.ssh` and `~/.aws`. They don't reliably
stop shell commands (a test let `head -1 .env` through); the
`protect-secrets` hook covers `cat`, `head`, `grep` and co. A script that
opens files itself (`python -c ...`) is covered by neither, which needs
Claude Code's sandbox.

**Pre-commit hooks** are written into the project's `.pre-commit-config.yaml`
by setup step 5. They run on every `git commit`, whoever makes the commit —
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
2. **Plan it** — Claude writes `plans/<branch>.md` (branch name without its
   prefix: `feature/PROJ-123-login` → `plans/PROJ-123-login.md`): goal,
   acceptance criteria (each with the test that proves it), steps, out of
   scope — stripped to the simplest version with `ponytail`.
3. **Approve it** — you read (and may edit) the plan file before any code is
   written.
4. **Implement it** — on a feature branch (optional in demo repos);
   subagents capped at Sonnet, each reading the plan file.
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
| `/repo-setup` | Sets a repo up for Claude Code: runs `/init` if there is no `CLAUDE.md`, otherwise proposes which instructions to move into rules, skills, hooks or permissions. The last step of `/agentic-kit-setup`; also runs on its own |
| `/grill-with-docs` | Grilling plus domain modeling: interview, glossary and ADRs in one go. Only you can start it; Claude uses `grilling` + `domain-modeling` directly |
| `/grilling` | The interview alone, without docs, in rounds of numbered questions with recommended answers |
| `domain-modeling` | Writes `GLOSSARY.md` and ADRs; loaded by `grill-with-docs` |
| `ponytail` | Simplest solution that works; active every session via the hook above |
| `pr-review` agent | Read-only review: acceptance criteria from `plans/<branch>.md` → implementation, then correctness, then simplicity (ponytail lens). Runs on Opus. |

`grilling`, `grill-with-docs` and `domain-modeling` are from
[mattpocock/skills](https://github.com/mattpocock/skills), `ponytail` from
[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) —
unchanged, so they can be updated by copying the upstream files again.

**`/repo-setup`** (by Szymon Kulpinski). In a repo without a `CLAUDE.md` it
starts Claude Code's built-in `/init` (or creates a `CLAUDE.md` that imports
an existing `AGENTS.md`). In a repo that has one, it reads `CLAUDE.md` and
the project's `.claude/` folder and lists what belongs somewhere else:
instructions for some files only become path-scoped rules, procedures become
skills, "always" and "never" instructions that must hold become hooks or
deny rules, and personal preferences move to `CLAUDE.local.md`. You pick the
findings to apply. Before the first change it copies the affected files to a
backup folder (`./.repo-setup-backup` by default, or one you name) and waits
for your OK. The rules it applies are in `skills/repo-setup/baseline.md`,
each with its source in Anthropic's documentation. Started by
`/agentic-kit-setup` it gets `--no-questions`: it applies every finding and
backs up to the default folder without asking.

**Built into Claude Code**, worth knowing alongside the kit (each only
proposes changes):

| | Use |
|---|---|
| `/doctor` | Setup checkup; trims `CLAUDE.md` of what Claude can read from the code itself |
| `/doctor prompt-audit` | Outdated, contradicting or broken instructions in `CLAUDE.md`, rules, skills and agents (Claude Code ≥ 2.1.283) |
| `/skill-doctor` | What each installed skill costs in context and how often it's used |

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

- **Node.js ≥ 18** — all Claude Code hooks are Node scripts. Claude Code
  itself runs without Node, but then every guard of the kit silently stays
  off; setup checks for Node first.
- **git** — for `git-safety` and the pre-commit hooks.
- **Python projects:** a project venv managed by `uv`, `poetry` or pip, plus
  `pre-commit`. Setup offers to install `pre-commit` and `ty` if they're
  missing.
- **Behind a company proxy:** if `uv` fails with `invalid peer certificate`,
  set `UV_SYSTEM_CERTS=1` so it trusts the system certificate store.
