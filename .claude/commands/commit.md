---
description: Suggest a one-line commit message for the current working tree
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

Suggest a commit message — do not commit.

1. Run `git status` and `git diff` (staged) to see what's changed.
2. If the diff is mixed staged + unstaged, ask the user which set to message before suggesting.
3. Run `git log -10 --oneline` to match the repo's existing style.
4. Output one line. No body, no bullets. Match the repo's casing and verb form.
