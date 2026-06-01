---
description: Dispatch the critic subagent to stress-test the current plan or proposal
---

Spawn the `critic` subagent via the Agent tool. Pass it:

- The plan or proposal text in full (from the conversation, plan mode output, or `$ARGUMENTS`)
- A note on what's already been decided vs. still open
- The user's actual goal — the critic critiques against the goal, not against the plan in isolation

Relay the critique to the user verbatim. If the critic flags a blocking concern, present it as something to address, not a verdict — the user decides whether the concern lands.
