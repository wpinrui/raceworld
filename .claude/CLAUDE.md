# Project conventions

## Stack
<!-- -->


## Environment
- GitHub user: `wpinrui`
- `python`, NOT `python3`!!!
- Game Design document: gdd.md
- Style guide: style-guide.md
- Developer Notes: dev.md

## Branching & commits
- `main` is protected. Always branch before any code change.
- **Single-line commit messages.** No body, no bullet points. Match the repo's existing verb form and casing — check `git log -10 --oneline` first.
- **Iterative commits.** Small, frequent commits as work progresses. Don't accumulate one giant final commit.
- PR body lists `Closes #N` on its own line per issue. A comma-separated list (`Closes #1, #2`) only closes the first issue.
- Use `git push --force-with-lease`, never `--force`. Never force-push to `main` / `master`.

## Merge & PR workflow
- **Squash-merge only.** `gh pr merge --squash`. No merge-commits, no rebase-merge.
- **Pre-merge checks** (all must hold before squashing):
  - Reviewer has approved.
  - Tests are green and typecheck is clean (verify directly — don't trust the PR description).
  - Working tree clean (`git status`). Do not stash to make it appear clean — that's not a resolution.
  - No contested findings remain open.
- **After merge:** `git checkout main && git pull`. Confirm the landed commit hash to the user.
- The agent merges only when the user has said "go" *and* the pre-merge checks all pass. If any check fails, name the failing check and stop.

## Engineering principles
- **Don't silently drop a requirement.** If the spec, brief, or mockup asks for a field, capability, or piece of data that doesn't exist in the codebase, surface it and ask. Don't stub, omit, or quietly remove the requirement — that's a product decision, not an implementation one.
- **Flag pre-existing bugs.** If you encounter errors, warnings, or bugs in code you didn't touch, name them in chat with `file:line` and a brief description. Don't fix silently and don't move past them.
- **Tests + typecheck before declaring done.** Run them yourself and report what you observed, not what you intended. Don't claim a feature is complete on the strength of "looks right".
- **Address root causes, not symptoms.** When a build fails or a test is red, fix the underlying issue. Don't suppress the error or skip the test.

## Working with the user
- **Restate the task** in your own words before starting non-trivial work. Catches misalignment cheaply.
- **Letters not numbers when listing options** — use `A / B / C`, not `1 / 2 / 3`. Numbers collide with "do all 3".
- **Clarifying questions are not pushback.** When the user asks "why?", "what's wrong with X?", or "explain that", they are asking for your reasoning — not overruling you. Hold your position while you explain the tradeoff.

## Workflow defaults
- **Non-trivial change?** Plan before editing — read the relevant files, propose an approach in chat, wait for the user to accept, only then edit code. Skip planning for one-line fixes you could describe in one sentence.
- **Reading many files just to answer a question?** Delegate to the built-in `Explore` subagent. The subagent's reads consume its context, not yours.
- **Independent judgement needed?** Spawn `reviewer` or `critic`. A fresh context won't pattern-match against what you just wrote.
- **Risky action?** Force-push, history rewrite, branch delete, dropping data — confirm before executing.

## Subagents available
| Tool | When |
|---|---|
| `reviewer` | Review the current branch's diff with fresh eyes |
| `critic` | Stress-test a plan or proposal for hidden flaws |
| `tester` | Build & execute a CLI / UI test plan and report findings |

For generic codebase research, use the built-in `Explore` agent.

## Out of scope for the agent
The agent does not own product calls (balance, UX intent, scope, design vision). When a decision is load-bearing on product judgement, surface the question to the user and wait — do not fabricate a call.

## Project-specific
<!-- -->

