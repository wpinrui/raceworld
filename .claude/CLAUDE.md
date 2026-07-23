# Project conventions

## Stack
- Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · better-sqlite3 · Zustand · Anthropic SDK · Lucide React · Radix UI · Recharts.
- Package manager: **npm**. Tests: **Vitest** (`npm run test`). Lint: **ESLint** (`npm run lint`). Typecheck: `npx tsc --noEmit`.
- **This is NOT the Next.js you know.** APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next code, and heed deprecation notices (see AGENTS.md).

## Environment
- GitHub user: `wpinrui`
- `python`, NOT `python3`!!! (a `PreToolUse` hook blocks `python3` — it triggers the Windows Store alias)
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
- **Non-trivial change?** Plan before editing — read the relevant files, propose an approach in chat, wait for the user to accept, only then edit code. Use the built-in `Plan` agent for a written strategy. Skip planning for one-line fixes you could describe in one sentence.
- **Reading many files just to answer a question?** Delegate to the built-in `Explore` subagent. The subagent's reads consume its context, not yours.
- **Independent judgement on a diff?** Run `/review` (the `code-reviewer` Opus agent) — a fresh context won't pattern-match against what you just wrote.
- **Risky action?** Force-push, history rewrite, branch delete, dropping data — confirm before executing.

## Commands & subagents
| Tool | When |
|---|---|
| `/review` → `code-reviewer` agent | Opus review of the branch diff against this bar; blocks merge on any blocker |
| `/loc` | Total SLOC and a longest-files audit flagging anything over the 500-line cap |
| `/mem-add` `/mem-view` `/mem-update` `/mem-delete` | Manual memory management (the project's `memory/` store) |
| built-in `Explore` | Broad, read-only codebase research |
| built-in `Plan` | A written implementation strategy without touching code |

## Out of scope for the agent
The agent does not own product calls (balance, UX intent, scope, design vision). When a decision is load-bearing on product judgement, surface the question to the user and wait — do not fabricate a call.

## Project-specific
- **Architecture** (see dev.md): the race simulation runs entirely client-side as a Zustand store — no DB writes mid-race; flush to SQLite at race end via a Server Action. The stats engine lives server-side (SQL queries via Server Actions, called from Standings and Newsroom). The Newsroom LLM is a Server Action calling Claude with tool-calling against the stats DB — the `ANTHROPIC_API_KEY` never leaves the server.
- **Data** is SQLite via better-sqlite3 (`raceworld.db`). `npm run db:init` initialises the schema. Saves are disposable — bump the schema version silently; never caveat about migrations or losing current-save data.
- **Probe scripts** live under `scripts/` and run via `tsx` (`npm run news:play`, `history:check`, `weather:check`, `wet:measure`, `pit:check`, `overall:calibrate`). Long sims must stream round-by-round progress with a running result, never run silent.
