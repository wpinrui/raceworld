# Project conventions

> **Read [`.claude/memory.md`](memory.md).** Every rule below that is marked (mem) is a one-line
> summary of a standing preference the user has already corrected an agent on, usually angrily. The
> reasoning, the concrete failure, and the exact banned strings live in `memory.md`. Read it before
> writing UI copy, news copy, or touching the review/merge flow.

# Flags
-iter means rapidly iterate, ping when there is something new to try/test. The user wants to make inputs into the project.
-afk means the user will be away, and the agent is expected to do work until task completion, including making autonomous decisions, and make incremental commits so that the user can check out a specific commit later
-rm means review the PR and then merge. -r means review without merge. -m simply means merge, but if the previous review is stale or does not exist then review first.

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
- **(mem) ONE feature branch in flight, ever.** If a branch is already checked out, ALL new work goes on it, even trivial unrelated tweaks. Never open a second branch and never `git checkout main` mid-work: he is running a dev server or a live sim off that tree and switching yanks it out from under him. This overrides "always branch" above whenever a feature branch is active.
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
- **After merge:** `git checkout main && git pull`. Confirm the landed commit hash to the user. (mem) Exception: if he has active work on another branch, leave him there. The checkout is for ending a clean merge cycle, not a reflex.
- The agent merges only when the user has said "go" *and* the pre-merge checks all pass. If any check fails, name the failing check and stop.
- **(mem) Phase 1 vs phase 2.** His shorthand: "phase 1" = build (branch, commit, push, PR, review, fix, verify, then **STOP**), "phase 2" = merge. Phase 1 is fully autonomous, phase 2 is gated.
- **(mem) Merge authorization is one-time and per-change. It NEVER carries forward.** A "go ahead" on one PR does not authorize the next one, even minutes later, even for an obvious bugfix. Never batch phase 1 and phase 2.
- **(mem) Run `/review` before every merge, unprompted.** Never ask "should I review?". It is mandatory, and asking reads as trying to skip the bar. It is the build side of phase 1 and never authorizes the merge itself.
- **(mem) Three finding classes are ALWAYS blocking**, never a nit or a WARN: (a) correctness bugs including display-only ones, (b) missing unit tests on newly-added logic, (c) DRY violations / near-verbatim duplication.
- **(mem) A review "fix" is not a redesign.** Auto-apply only mechanical/correctness fixes. Anything that would change his specced mechanism, algorithm, balance, or model shape gets SURFACED and asked, even if the reviewer calls it a blocker.
- **(mem) To check whether a branch landed, never grep its original commit hash** (squash discards it). Use `gh pr view`, `gh pr list --state merged`, or compare content with `git diff main -- <file>`.

## Engineering principles
- **Don't silently drop a requirement.** If the spec, brief, or mockup asks for a field, capability, or piece of data that doesn't exist in the codebase, surface it and ask. Don't stub, omit, or quietly remove the requirement — that's a product decision, not an implementation one.
- **Flag pre-existing bugs.** If you encounter errors, warnings, or bugs in code you didn't touch, name them in chat with `file:line` and a brief description. Don't fix silently and don't move past them.
- **Tests + typecheck before declaring done.** Run them yourself and report what you observed, not what you intended. Don't claim a feature is complete on the strength of "looks right".
- **Address root causes, not symptoms.** When a build fails or a test is red, fix the underlying issue. Don't suppress the error or skip the test.

## Working with the user
- **Restate the task** in your own words before starting non-trivial work. Catches misalignment cheaply.
- **Letters not numbers when listing options** — use `A / B / C`, not `1 / 2 / 3`. Numbers collide with "do all 3".
- **Clarifying questions are not pushback.** When the user asks "why?", "what's wrong with X?", or "explain that", they are asking for your reasoning — not overruling you. Hold your position while you explain the tradeoff.
- **(mem) Just commit.** Finished and verified work gets committed and pushed to the current branch without asking. Never end a turn with "want me to commit?".
- **(mem) Never stop mid-task.** No halfway checkpoints, no "here's what's done, here's what's left, say the word". On a multi-part task, work straight through to a finished, verified, committed state. A limited context budget is not a reason to stop early: commit working increments and keep going. Never say "continuing now" and then stop.
- **(mem) Never offer a stop option.** On agreed work, "stop here / do nothing" is not a choice to present. When he has delegated ("you lead", "I don't care", "just do it"), skip option menus entirely: pick the sensible path and ship. No milestone summaries, no "keep going on X or pivot to Y?".
- **(mem) Read the tone.** Frustration plus a pointed callout ("what is this for?") is a directive to fix it, so just fix it. A calm question is a question: answer it, do not bulldoze into code changes.
- **(mem) Ask-question protocol.** Never call AskUserQuestion inline. Announce in plain text, STOP the turn completely, wait for his acknowledgement, and only then call the tool. He is notified on stop, not on tool-call.
- **(mem) "Collaborative effort" / "you lead" means work WITH him**, not fan out to subagents and present a finished result. Propose, check in, build incrementally. Especially on design, layout, and UX.
- **(mem) An example is one instance of a whole class.** Generalize across every continuum, never over-fit the single case he showed.
- **(mem) Sweep the class.** Cross-cutting changes are invariants: grep and enumerate every occurrence FIRST, list it, fix all in one pass, prove coverage. Never fix the one screen he screenshotted. When adding a mode that parallels an existing one, the sibling's flag IS the checklist.
- **(mem) Never de-scope for effort.** When he asks for experience or completeness, do not rank or trim by implementation difficulty or "keeping the PR reviewable".
- **(mem) Judge from the player's seat.** "Does this make sense for the player?" is the bar. "The code is correct / the test passes" is necessary and never sufficient.
- **(mem) Measure before claiming.** Never state a cause or cite a number you have not measured. "I don't know yet", then go measure.
- **(mem) Never blame his environment.** Never suggest he did not refresh, reload, or pull, or that he has a stale cache. A "still broken" report means the fix was wrong or incomplete.
- **(mem) The workspace IS his local copy.** Edits are live in his tree and hot-reload into his dev server. Never tell him to pull, sync, or rebuild to see them.
- **(mem) Never run the dev server** or any persistent process. One-shot commands only. He runs his own.

## Workflow defaults
- **Non-trivial change?** Plan before editing — read the relevant files, propose an approach in chat, wait for the user to accept, only then edit code. Use the built-in `Plan` agent for a written strategy. Skip planning for one-line fixes you could describe in one sentence.
- **Reading many files just to answer a question?** Delegate to the built-in `Explore` subagent. The subagent's reads consume its context, not yours.
- **Independent judgement on a diff?** Run `/review` (the `code-reviewer` Opus agent) — a fresh context won't pattern-match against what you just wrote.
- **Risky action?** Force-push, history rewrite, branch delete, dropping data — confirm before executing.
- **(mem) Rapid iteration is a MODE, not a diff size.** If he is terse and rapid-firing tweaks or reacting to screenshots, you are in the loop: just make the change and report it. No tests, no full battery, at most `npx tsc --noEmit` on the touched file. Subagents inherit the mode. Batch ALL housekeeping (tests, full checks, review) to the end of the loop.
- **(mem) Think, don't autopilot.** Treat checklists as defaults to reason about, not scripts to run. Ask what a habitual action does to him right now.
- **(mem) Playtest notes come one at a time**, end to end. Consult on the fix METHOD before implementing design-heavy notes: state the question in plain prose in chat, not via AskUserQuestion, and stop.

## Commands & subagents
| Tool | When |
|---|---|
| `/review` → `code-reviewer` agent | Opus review of the branch diff against this bar; blocks merge on any blocker |
| `/loc` | Total SLOC and a longest-files audit flagging anything over the 500-line cap |
| `/mem-add` `/mem-view` `/mem-update` `/mem-delete` | Manual memory management (the project's `memory/` store) |
| built-in `Explore` | Broad, read-only codebase research |
| built-in `Plan` | A written implementation strategy without touching code |

## Hard rules (mem)
Absolute. Breaking one of these is worse than shipping nothing. Full reasoning in [`memory.md`](memory.md).
- **All readable text is pure white `#FFFFFF`.** `#E8EAED` and `#A0A9B8` are BANNED. `#6B7280` only for non-readable placeholder/disabled. Accent `#00D9FF`. One approved exception: READ news headlines use `#9CA3AF` to contrast with unread white.
- **No em dashes** (—) in user-facing copy, PR text, or commit text. He reads them as an AI tell. Use a comma, colon, parentheses, or a full stop.
- **No hand-holding copy.** No "Hit End Race (top right) to continue", no "press X to…", no location pointers, no chart "how to read me" subtitles, no empty-state instructions. Build the control and let its label speak. This is a recurring failure in the agent's own component copy: self-audit every rendered string before shipping.
- **No accessibility.** Never add `aria-*`/`role`/screen-reader markup, never cite a11y as a reason. It is a game.
- **Always gendered pronouns** for drivers. Neutral "they" or pronoun-avoidance is unacceptable. Use `pronouns(gender)` in `src/lib/news/util.ts`. If gender is not on hand, RESOLVE it: `driver_genders` table, then `historicalDrivers` in `src/data/history/drivers.ts`, then `male` as a last resort.
- **Never run the dev server** or any persistent process.
- **`python`, never `python3`.**

## UI conventions (mem)
- **Never native `title=` tooltips.** Use the Radix-based `<Tooltip>` at `src/components/ui/Tooltip.tsx`.
- **Icons by default.** lucide-react on controls, labels, statuses and panel headers; pictorial identity on entities (flag, team crest and colour). Never ship text-only chrome and make him ask.
- **Flags are always SVG** via `NationalityFlag` (`src/components/world/NationalityFlag.tsx`, wraps `react-country-flag`). Never emoji, never a bare ISO code.
- **Driver hover card** = Overall + Potential only (not the four sub-attributes), plus career totals: seasons, races, wins, poles, podiums, points. Reuse `DriverTooltip`.
- **No blanket empty-state.** Never hide a whole view behind "no data yet" when static or start-state data exists. Pre-season car pace, ratings and grid MUST render. Scope empty-states to the truly-empty sub-panels.
- **Game modes are standalone screens**, never config checkboxes. Mode-specific config lives in that mode's own panel.
- **Reuse the shared screen.** A player-interactive variant of an existing flow integrates into that flow's screen (the Driver signing-day offer goes into `SigningDayBoard`, like TM's draft does). Never build a parallel component.
- **Saves are disposable.** Never caveat about losing current-save data or "only applies to new races". Bump the schema version silently.

## News engine & generated copy (mem)
Prose in `src/lib/news/engine.ts`, helpers in `src/lib/news/util.ts`. Read `memory.md` for the exact banned strings.
- **Sonnet writes every prose string**, never the main agent: headlines, deks, bodies, pools, quotes. Opus writes mechanism only (producers, slot wiring, pickers), then QCs and wires. Have the subagent RETURN strings, not edit files.
- **Plain and short.** No flowery flourish ("speaks to real conviction", "carries the weight of expectation"). Subject-verb-object, the way a person talks. QC every Sonnet line for purple prose before wiring: this is the step that keeps failing.
- **No fluff closers.** Every sentence carries a grounded fact or a specific detail, else STOP. Also banned: data-caveat/editorial closers ("read it with caution", "tells half the story", "the usual health warning", "time will tell").
- **Short and chunked.** One sentence names a whole list of entities; never loop per-entity. No colons in titles, no percentages in market UI, free-agency framing not draft jargon.
- **The engine knows everything.** `NewsContext` has all rounds' results, grid positions, and `ctx.careers`. Pole, prior finishes, maiden wins are all derivable: compute them and pass as slots. Never call a derivable fact "unknown".
- **Unmodelled colour is a required feature**, not a bug. Safety cars, dehydration, garage mood, radio: the sim does not track them, which is exactly why they can never contradict the data. Never strip a detail for being unsimulated. Only avoid asserting a different value for a TRACKED quantity.

## Out of scope for the agent
The agent does not own product calls (balance, UX intent, scope, design vision). When a decision is load-bearing on product judgement, surface the question to the user and wait — do not fabricate a call.

## Project-specific
- **Architecture** (see dev.md): the race simulation runs entirely client-side as a Zustand store — no DB writes mid-race; flush to SQLite at race end via a Server Action. The stats engine lives server-side (SQL queries via Server Actions, called from Standings and Newsroom). The Newsroom LLM is a Server Action calling Claude with tool-calling against the stats DB — the `ANTHROPIC_API_KEY` never leaves the server.
- **Data** is SQLite via better-sqlite3 (`raceworld.db`). `npm run db:init` initialises the schema. Saves are disposable — bump the schema version silently; never caveat about migrations or losing current-save data.
- **Probe scripts** live under `scripts/` and run via `tsx` (`npm run news:play`, `history:check`, `weather:check`, `wet:measure`, `pit:check`, `overall:calibrate`). Long sims must stream round-by-round progress with a running result, never run silent.
- **(mem) Sims stream progress.** Round-based structure: run a small batch across all cases, print the full current numbers, repeat, so he has a complete if noisy answer after round one and can Ctrl-C any time. Never compute-everything-then-print-once.
- **(mem) Prefer `sampleNormal(mean, stddev, rng)`** for continuous attributes that should cluster (stats, ratings, pace deltas, upgrade impacts). Flat uniform only for genuinely discrete or categorical picks.
- **(mem) Lap-time formula constants** (car pace, driver pace, effective stat, overtaking probability, full assembly) are written out in [`memory.md`](memory.md) section 6. Use those, not a reading of the GDD.

## In-flight work (mem)
Point-in-time notes, detail in [`memory.md`](memory.md) section 7. Verify file:line against current code.
- **`feat/sim-2d-overhaul` renderer perf.** Canvas beats SVG (58 fps / 16 long frames vs 43 / 140). Residual pit-straight raster dips are ACCEPTED. His machine blits big canvases slowly: never reintroduce full-frame `drawImage` without benchmark proof. Probes: the 'n' key lap-aligned bench behind `DEBUG_KEYS`, `scripts/canvas-cost-check.ts`, `npm run zoom:check`.
- **PR #57 / `feat/electron-desktop`** (portable Windows exe) is intentional WIP, paused 2026-06-06, left as a DRAFT on purpose. Not stale. Do not close or clean it up. Resume on request.
- **FM-style day-by-day clock** is a planned PR: gate all news display to `date <= currentDate`. The interrupt machinery already exists (`computeNextStop`, `articleInterrupts`); the gap is the eager Home preview and `season-store.ts:604` parking the clock on the last race's date.
