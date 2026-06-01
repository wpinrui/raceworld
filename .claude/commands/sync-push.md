---
description: Push local .claude/ improvements from a project up to the canonical upstream repo
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are syncing **up** — taking the local `.claude/` from a project and pushing improvements to the upstream. Argument (optional): source project path. If unset, ask the user which project to upload from; do not assume it's the current one.

## Upstream
`wpinrui/claude-agents` — hardcoded. Do not prompt for it.

## Workflow

1. **Confirm source project** with the user before doing anything else.
2. **Clone the upstream** to a temporary directory (`git clone --depth 1`). All write operations happen inside this clone — never in the source project.
3. **Copy** every file under the source's `.claude/` into the clone, overwriting.
4. **Scrub project-specific sections** from each copied file:
   - Find every `## Project-specific` heading.
   - If the body is whitespace + a single HTML comment placeholder (e.g. `<!-- Project-specific conventions go here. Keep it short. -->`), **leave it untouched.** The upstream placeholder is canonical.
   - If the body contains real project prose (anything beyond a single HTML comment), clear the body. Leave the heading.
   - Never delete the heading itself.
5. **Filter noise diffs.** Whitespace / EOL / trailing-newline churn is *not* a real change. Use `git diff --ignore-all-space --ignore-blank-lines` when deciding what counts. Files with no real diff after scrubbing → drop from the summary.
6. **Categorise every real difference**:
   - **Local additions** — files local that don't exist upstream. Safe to add.
   - **Local modifications** — files changed locally, upstream unchanged since last sync. Safe to update.
   - **Upstream-only changes** — modifications upstream that aren't in the source. Likely pushed by another project. **Flag to the user.** Do not overwrite without explicit approval.
   - **Both changed** — same file modified upstream and locally. **Flag to the user** with both versions side by side. Do not overwrite without explicit approval.
7. **Present the full summary.** Wait for explicit confirmation on each bucket.
8. On confirmation, **commit and push directly to `main`** in the temporary clone:
   - Commit message: `sync from <source-repo-name> · <YYYY-MM-DD HH:MM>` (single line).
   - `git push origin main`. The user owns this upstream and explicitly does not gate via PR.
9. **Clean up** the temporary clone.
10. **Report** in chat: source project, commit hash, what was pushed, what was flagged.

## What you do not do
- Do not modify the source project in any way — read-only.
- Do not run on the upstream repo itself — refuse and explain.
- Do not force-push. If `git push` is rejected (upstream moved), stop, surface the conflict, and ask the user how to proceed.
