# Baseline: where an instruction belongs

Taken from official Anthropic sources only. Each rule names its source:

- **[S1]** [Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)
- **[S2]** [How Claude remembers your project](https://code.claude.com/docs/en/memory)
- **[S3]** [Extend Claude Code](https://code.claude.com/docs/en/features-overview)

Syntax details, when drafting a file: [skills](https://code.claude.com/docs/en/skills),
[hooks](https://code.claude.com/docs/en/hooks-guide),
[permissions](https://code.claude.com/docs/en/permissions).

## The mechanisms

| Mechanism | Loads | Costs context | Holds |
|---|---|---|---|
| `CLAUDE.md` at the root (or `.claude/CLAUDE.md`) | Every session, re-read after compaction | Every line, every session | Facts Claude needs all the time |
| `CLAUDE.md` in a subdirectory | When Claude reads a file in that directory | Only then | Conventions of that directory |
| `.claude/rules/*.md` with `paths:` | When Claude reads a matching file | Only then | A constraint for some files |
| `.claude/rules/*.md` without `paths:` | Every session | Same as `CLAUDE.md` | A topic split out of `CLAUDE.md` |
| `.claude/skills/<name>/SKILL.md` | Name and description every session; the body when invoked | Low | Procedures and reference material |
| `.claude/agents/<name>.md` | Name and description every session; runs in its own context | Low | Side tasks that return only a summary |
| Hook in `.claude/settings.json` | Never; Claude Code runs it on an event | None, unless it returns output | Things that must happen every time |
| `permissions.deny` in `.claude/settings.json` | Never; Claude Code enforces it | None | Things that must never happen |
| `CLAUDE.local.md`, `~/.claude/CLAUDE.md` | Every session, for you only | Every line | Personal preferences |

Source: the table in [S1]; file locations in [S2].

## Rules

### What stays in CLAUDE.md

- **P-01** `CLAUDE.md` holds what every session needs: build and test commands, directory layout, coding conventions, team norms. [S1] [S2]
- **P-02** Each `CLAUDE.md` stays under 200 lines. Longer files cost context and are followed less reliably. [S1] [S2]
- **P-03** Instructions are concrete enough to verify: "Use 2-space indentation", not "Format code properly". [S2]
- **P-04** No two instructions contradict each other, across `CLAUDE.md`, nested `CLAUDE.md` files and `.claude/rules/`. [S2]
- **P-05** A repo with `AGENTS.md` has a `CLAUDE.md` that imports it with `@AGENTS.md` instead of repeating it. Claude Code reads `CLAUDE.md`, not `AGENTS.md`. [S2]
- **P-06** `@path` imports organise a file but save no context: imported files load at launch too. [S2]

### What moves out

- **P-10** An instruction for some files only (one language, one layer, file names that occur in several places) is a rule in `.claude/rules/<topic>.md` with `paths:`. [S1] [S2] [S3]
- **P-11** A rule without `paths:` that names specific files or directories gets `paths:`. Unscoped, it costs the same as `CLAUDE.md`. [S1]
- **P-12** Conventions for one subdirectory, such as one team's package in a monorepo, are a `CLAUDE.md` in that subdirectory. Use a path-scoped rule instead when the concern cuts across several directories. [S1]
- **P-13** A multi-step procedure (deploy, release, review checklist) is a skill. So is reference material Claude needs only sometimes (API docs, style guide). [S1] [S2] [S3]
- **P-14** "Every time X, do Y" that must happen reliably (format after edit, notify on completion) is a hook. In `CLAUDE.md` it is a request that Claude may skip. [S1] [S3]
- **P-15** "Never do X" that must hold is a `permissions.deny` rule or a `PreToolUse` hook that exits with code 2. A prompt instruction can fail in long sessions or under prompt injection. [S1] [S2] [S3]
- **P-16** A personal preference is not in the shared `CLAUDE.md`. It goes to `CLAUDE.local.md`, which is listed in `.gitignore`, or to the user's own `~/.claude/CLAUDE.md`. [S1] [S2]
- **P-17** A side task that floods the conversation with output nobody reads again (deep search, log analysis) is a subagent, not a skill. [S1] [S3]

### What the existing `.claude/` should look like

- **P-20** Each rule file covers one topic and has a descriptive name, such as `testing.md` or `api-design.md`. [S2]
- **P-21** Each skill is a folder with a `SKILL.md` that has a `name` and a `description`. The description says when to use the skill, because it is all Claude sees until the skill is invoked. [S1]
- **P-22** Each subagent file has `name` and `description` frontmatter; the body is its system prompt. [S1]
- **P-23** A hook does work that needs no judgement. If Claude should decide how to apply the steps, it is a skill. [S3]

## File shapes

A path-scoped rule, `.claude/rules/api.md` [S1] [S2]:

```markdown
---
paths:
  - "src/api/**"
  - "**/*.handler.ts"
---
All API handlers must validate input with Zod before processing.
```

A skill, `.claude/skills/deploy/SKILL.md` [S1]:

```markdown
---
name: deploy
description: Deploys the app to staging or production. Use when the user asks to deploy or release.
---
1. Run the test suite.
2. ...
```

A deny rule and a hook, both in `.claude/settings.json` [S1] [S3]:

```json
{
  "permissions": {
    "deny": ["Edit(./.env)", "Bash(git push --force *)"]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npx prettier --write ." }]
      }
    ]
  }
}
```
