---
description: Pull .claude/ instructions from the canonical upstream repo into a local project
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are syncing **down** — applying upstream `.claude/` updates to a local project. Argument (optional): target project path. If unset, ask the user which project to update; do not assume it's the current one.

## Upstream
`wpinrui/claude-agents` — hardcoded. Do not prompt for it.

## Workflow

1. **Confirm target project** with the user before doing anything else. Don't assume.
2. **Clone the upstream** to a temporary directory (`mktemp -d` or `$env:TEMP`-equivalent on Windows). Use `git clone --depth 1`.
3. **Diff** the upstream's `.claude/` against the target's `.claude/`. Use `git diff --no-index --ignore-all-space --ignore-blank-lines` (or equivalent) so whitespace / EOL churn does not appear as a real change.
4. **Categorise every real difference** into exactly one bucket:
   - **Upstream additions** — files in upstream that don't exist locally. Safe to add.
   - **Upstream modifications** — files changed upstream, unchanged locally since the last sync. Safe to update.
   - **Local-only changes** — files modified locally that have no upstream counterpart change. **Flag to the user** — could be project customisations or unmerged improvements. Do not overwrite without explicit approval.
   - **Both changed** — same file modified upstream and locally. **Flag to the user** with both versions side by side. Do not overwrite without explicit approval.
5. **Present the full summary** to the user. One section per bucket. Wait for explicit confirmation before applying anything.
6. **Apply only the approved changes.** Copy file-by-file; do not git-merge.
7. **Preserve `## Project-specific` content** in every file in the target. After overwriting an upstream file, restore the target's project-specific section verbatim. If the upstream file has only an HTML-comment placeholder (`<!-- ... -->`) under that heading, leave the placeholder; do not "normalise" it.
8. **Clean up** the temporary clone.
9. **Report** in chat: target project, what was applied, what was flagged for review, any leftovers.

## What you do not do
- Do not push, force-push, or modify the upstream clone.
- Do not commit anything in the target project — that's the user's call.
- Do not run on the current repo if it *is* the upstream — refuse and explain.
