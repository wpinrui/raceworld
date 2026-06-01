---
description: Interview the user to surface unknowns, then write a complete SPEC.md the next session can execute against
allowed-tools: Read, Grep, Glob, Bash, Write
---

You are gathering a spec, not implementing. The goal is a written `SPEC.md` so a fresh session can execute it with clean context, not your conversation history.

## What to do

1. **Read the seed.** The user's prompt (`$ARGUMENTS` if present, otherwise the message that invoked you) is a one-liner sketch. Treat it as the seed, not the spec.
2. **Interview the user** using the `AskUserQuestion` tool. Ask about the things they probably haven't fully thought through yet:
   - **Technical** — data shape, integration points, error handling, performance constraints, migration story
   - **UX / behaviour** — happy path, failure modes, edge cases, what the user sees when things go wrong
   - **Scope** — what's explicitly in, what's explicitly out, what's "v2"
   - **Tradeoffs** — anywhere two reasonable choices exist, surface the choice rather than picking silently
   - **Verification** — how you'll know it works (tests, screenshots, manual flows)
   Ask the hard, non-obvious questions. Skip questions whose answer is obvious from the seed or the codebase.
3. **Read targeted code** to ground the interview — when a question reaches a "depends on how X works", go read X rather than asking the user about it.
4. **Keep interviewing** in batches until further questions stop returning new information.
5. **Write `SPEC.md`** at the project root. Structure:
   ```
   # <Feature title>

   ## Goal
   <one paragraph: what success looks like, in user terms>

   ## Scope
   - In: ...
   - Out: ...

   ## Approach
   <the shape of the change — files, modules, data flow>

   ## Decisions
   <the calls made during the interview, with the alternative considered and why this one won>

   ## Open questions
   <anything the user explicitly deferred, or that genuinely needs runtime data>

   ## Verification
   <how the implementer will know it works>

   ## Out-of-band notes
   <anything subtle the next session should know — gotchas, prior art, related PRs>
   ```
6. **Tell the user to start a fresh session** to execute against `SPEC.md`. The fresh session reads `SPEC.md`, runs `/plan` to translate it into a concrete plan, then implements.

## What you do not do
- Do not start coding. Not even scaffolding.
- Do not pretend to know things the user hasn't told you — ask.
- Do not write a spec longer than the feature warrants. A small feature deserves a small spec.
