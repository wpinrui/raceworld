---
description: Build and execute a test plan for the current PR
---

Spawn the `tester` subagent via the Agent tool. Pass it:

- The current PR number (or branch name if no PR yet)
- Any specific concern from the user (`$ARGUMENTS`)

Relay the agent's findings table and verdict in chat. If the verdict is `blocked`, name the failing items in your reply so the user can route the fix.
