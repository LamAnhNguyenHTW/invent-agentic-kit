---
name: lsp
description: Switch the lsp-first hook on or off for this repo, or show its status.
argument-hint: "[on|off|status]"
disable-model-invocation: true
# Matches the script under any plugin path: the path may contain spaces and get quoted.
allowed-tools: Bash(node *lsp-first/lsp-first.js*) PowerShell(node *lsp-first/lsp-first.js*)
---

Run this from the repo root, with `status` if no argument was given:

    node "${CLAUDE_PLUGIN_ROOT}/hooks/lsp-first/lsp-first.js" $ARGUMENTS

Show its output as it is. If a language reports no LSP, name the missing
piece and point to `/agentic-kit-setup` step 6, which installs it. Change
nothing else.
