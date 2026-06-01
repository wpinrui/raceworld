---
description: Produce a plan for the current task without editing code
allowed-tools: Read, Grep, Glob, Bash
---

You are planning, not implementing. Do these in order:

1. Restate the task in one sentence.
2. Read the files most likely to be affected. Use `Glob` and `Grep` to locate them; read each in full once you know it's relevant.
3. Produce a plan with:
   - **Goal** — what success looks like, in user terms
   - **Approach** — the shape of the change in 3–6 bullets
   - **Files** — what gets touched and why
   - **Out of scope** — what you are deliberately not doing
   - **Risks** — what could go wrong, what assumptions you're making
   - **Checks** — how you'll verify it works (tests, typecheck, manual)
4. Stop. Wait for the user to accept, edit, or reject the plan.

Do not edit code. Do not commit.

**One PR per plan.** If the work splits into multiple PRs, structure the plan as one self-contained section per PR — each with its own scope, deliverables, and success criteria — and make the dependency order explicit ("PR 2 starts after PR 1 merges").

If you discover the task is bigger than you assumed, say so and recommend splitting before going further.
