---
description: Dispatch the reviewer subagent on the current branch's diff
---

Spawn the `reviewer` subagent via the Agent tool to review the current branch's diff against `main`.

Pass the agent a short prompt that:
- Names the branch and PR (if there is one)
- Mentions any specific area the user wants special attention on (if `$ARGUMENTS` is non-empty, include it)
- Says whether this is a fresh review or a re-review

When the agent returns, relay its findings to the user verbatim — do not summarise away severity. If there are blocking findings, do not propose fixes yet; let the user decide whether to fix here or hand off.
