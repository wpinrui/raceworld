---
description: Opus review of the current branch against the engineering bar (CLAUDE.md). Blocks merge on any blocker.
argument-hint: "[optional focus or PR number]"
---

Review the pending changes on the current branch against the project's engineering bar.

1. Gather the change under review:
   - `git diff main...HEAD` — the branch's committed changes.
   - `git diff HEAD` — any uncommitted working-tree changes.
   Exclude generated files (`dist/`, `node_modules/`, lockfiles).
2. Delegate the review to the **code-reviewer** subagent (Opus), passing the diff and letting it Read full files for context.
3. Relay its findings and final verdict. Do not approve while any blocker stands; if approved, report that the merge gate is clear.
4. Run the local suite (`npm run test`) and typecheck (`npx tsc --noEmit`) as the required pre-merge gate. The whole Vitest suite is fast, so run it in full; if anything fails, name the failure and stop. There is no CI or pre-commit hook, so this run is the only place tests execute — don't trust the PR description over a direct run.

$ARGUMENTS
