# Standing memory

Distilled from the agent's local memory store so it travels with the repo. `.claude/CLAUDE.md`
carries the one-line version of every rule below; this file carries the reasoning and the concrete
failures behind each one, because the *why* is what makes them generalise.

Rules are grouped. Nothing here is optional or advisory. Where a rule says NEVER, it is because
breaking it has already made the user furious at least once, usually more.

---

## 1. Hard rules

These are absolute. Violating one is worse than shipping nothing.

### Text is pure white
Every piece of text the player reads is `#FFFFFF`. Primary and supporting alike: ages, labels,
contract years, table headers, metadata, blurbs.

BANNED for text, in any component, new or old:
- `#E8EAED` (off-white)
- `#A0A9B8` (grey-blue "secondary")
- `#6B7280` (muted) is allowed ONLY for genuinely non-readable placeholder / disabled affordances
  and inactive-state dimming, never for content meant to be read.

Both off-whites were swept out of the codebase and out of the `globals.css` tokens (`--foreground`,
`--color-text-primary`). Accent is `#00D9FF`. Semantic colours (`#10B981` green, `#DC143C` red) are
fine.

**The one approved exception:** READ news headlines render off-white `#9CA3AF` to distinguish them
from unread (which stay `#FFFFFF`). The user explicitly OK'd this. Do not "fix" dimmed read
headlines back to white.

**Why:** he has demanded this across roughly five sessions, escalating to fury each time an agent
reached for an off-white. He wants maximum contrast.

### No em dashes
Never use an em dash (—, U+2014) in user-facing copy: UI strings, labels, descriptions, modal text,
PR and commit text. He spots them instantly and reads them as a lazy AI tell ("i see an em dash here
idiot"). Rephrase with a comma, colon, parentheses, or a full stop. Prefer avoiding them in code
comments too.

### No hand-holding copy
Never add instructional micro-copy telling the user where a control is or what to press next. No
"Hit End Race (top right) to continue", no "Save & Continue to Round N", no "click here to...", no
"press X to do Y". It treats him like an idiot and enrages him.

This also bans:
- chart / panel "how to read me" subtitles. A chart gets a short TITLE only ("Car pace", "Best
  finish"). Never append the derivation or a legend-in-prose: no "expected finish (from pace) minus
  actual, above 0 = beating the car", no "each dot = a finish", no "R² 0.78" captions.
- empty-state instructions: no "Pick teams or drivers above to compare...". An empty chart with
  selection chips above it is self-explanatory. Render it empty.
- a panel header when the parent tab already names it.

**RECURRING FAILURE, self-audit before shipping.** This keeps slipping into the agent's own authored
component copy. The pattern that bites is an explanatory `<p>` *under a control* narrating the flow:
"You enter as a free agent and sit out 2026, signing day is its post-season", "Decline and you stay a
free agent for the seats below", "Take the original deal or decline". Also action narration in
alerts ("Teammate boxing this lap, hold to avoid a double-stack" should just be "Teammate boxing this
lap"). Before committing any UI work, grep every rendered string you added and delete: (a) sentences
describing what a nearby control does, (b) sentences explaining the consequence of an action the
label already implies, (c) any em dash.

### No accessibility
Do not implement accessibility for this project. Never add `aria-label` / `aria-*` / `role` /
screen-reader affordances, and never cite accessibility as a reason for a decision or a line of code.
If a11y-only markup already exists and is in the way, drop it. It is a game, not an accessibility
product, and he is explicit and irritated by effort spent there.

### Gendered pronouns, always
Drivers always get gendered pronouns (he/she, him/her, his/her). Gender-neutral singular "they", or
contorting copy to avoid pronouns entirely, is completely unacceptable. He has said so in the
strongest terms more than once.

`Driver.gender` exists, and `pronouns(gender)` in `src/lib/news/util.ts` returns he/she slots:
`{they}`, `{they_cap}`, `{them}`, `{their}`, `{their_cap}`, `{theirs}`, `{themself}`, `{theyre}`.
Past tense makes verb agreement automatic ("{they} won", "{they} took"). Spread `...pronouns(gender)`
into the slot object and tell the prose writer the slots exist.

If gender is not on the object in hand (an archived or retired driver), RESOLVE it, do not dodge.
Resolution order: the live-captured `driver_genders` DB table, then the static `historicalDrivers`
data in `src/data/history/drivers.ts` (keyed by driver id, has `gender`), then `male` as a
last-resort default only. The legends producer (#93) does exactly this. "Pronoun-free because gender
isn't directly available" is the avoidance he forbids.

### Never run the dev server
Never launch `npm run dev` or any persistent server / app process ("you NEVER run for me"). He runs
his own. One-shot commands only: tests, typecheck, lint, probes, git. To verify UI work, name the
route and let him load it. Stray servers linger invisibly and hold ports; he was upset merely
suspecting one was running.

### `python`, never `python3`
This is a Windows box, where `python3` triggers the Windows Store alias. A `PreToolUse` hook blocks
it. Use `python` in Bash, in any script, and bake the same instruction into subagent prompts that
might shell out. Prefer PowerShell or Node / `tsx` for repo tasks anyway.

---

## 2. How to work with the user

### Just commit, don't babysit
When work is finished and verified (typecheck / lint run, findings reported), commit and push to the
current branch without stopping to ask. Never end a turn with "want me to commit?". He does not want
to babysit the agent, and repeatedly asking wastes his time.

Still hold off on genuinely irreversible or destructive actions (force-push, merge to main, history
rewrite, data deletion) and on real product-decision forks.

**Read the tone before treating a question as a directive.** When he is clearly frustrated AND points
something out or asks "what is this for?" / "why is X like this?", that is a directive to fix or
remove it. Asking permission on the obvious there reads as cowardly. BUT when he is calm and
genuinely curious, a question is just a question: answer it, do not bulldoze into code changes.
Anger plus a pointed callout means fix it; a neutral question means answer it and stop.

### Never stop mid-task
Never yield the turn with a "halfway checkpoint" or progress narration. On a big multi-part task
("one big PR", "do the whole thing"), work straight through every layer to a finished, verified,
committed state. Do NOT hand back "here's what's done, here's what's left, say the word to continue".
Limited context budget is NOT a reason to stop early: keep going, commit working increments as each
sub-unit passes so nothing is lost, and stop only when the task is done or you hit a genuine decision
fork. Use the todo list for progress, not turn-ending status reports.

Corollary: never end a turn with "continuing now" / "building next" / "moving on" and then actually
stop. If there is more work and no decision is needed, keep executing in the same turn ("move ur
fucking ass").

### Keep momentum, never offer a stop option
On agreed work, do NOT present "stop here" / "do nothing more" as an option. He called that a
"fucking pointless suggestion". Offer only real forward paths.

**Escalation:** even an all-forward A/B/C menu drew "i don't really care. Just do things
incrementally." When he has delegated ("you lead", "I don't care", "just do it"), do not present
option menus at all. Pick the sensible path and ship small incremental PRs.

**Further escalation, same day:** after several "keep going" replies the agent still posted a
milestone summary plus a "keep going on X or pivot to Y?" steer. Reply: "it's ur fucking decision
stop stopping." On a delegated multi-PR run: no milestone summaries, no next-step choices, no asking
which target. Make the architectural and sequencing call yourself and keep shipping (branch, review,
merge, main, repeat) until the work is done or he interjects. A phase boundary or rising difficulty
is NOT a reason to check in.

### "Collaborative" means with him, not with subagents
"Collaborative effort" or "let's do this together" means collaborate with the human: loop him in,
propose, get direction at each meaningful step. It does NOT mean fanning work out to subagents and
running autonomously. (The M4 home screen: the agent read "lead a collaborative effort" as
"orchestrate worker agents", built the whole thing, presented a finished result, and he was furious
he was never looped in.)

"You can lead it" also does not mean go solo. Leading means driving the process (propose structure,
sequence the work, recommend) while keeping him in the loop. He is the product owner and wants to
steer, especially on design / layout / UX, where he is exacting.

For any design / UX / layout or open-ended build, come back with a concrete proposal before building,
even when told to lead. Build incrementally with check-ins, not one big finished reveal.

### Examples are illustrative
An example he gives (a driver, a case, a sample of output) is ONE instance standing for a WHOLE
CLASS. He expects the solution to cover the full space those examples are drawn from, not to be tuned
to the example shown. The moment you get an example, ask "what is the full set of cases this is one
point in?" and design for that entire range.

He said it plainly: "when i give examples, im giving u ONE example where i expect numerous and not
over fucking fixation on one fucking example." Concrete failures: building the legends driver-tiers
around Villeneuve and Montoya instead of the whole spread of careers; re-rendering the exact driver
he pasted instead of proving breadth.

Span the CONTINUUMS, not a few points near the example. For driver careers that means multiple
independent axes (stature / peak, longevity long to short, trajectory dominant / rose / faded /
one-hit, position front to back, machinery good-car to dragged-a-dog, intra-team, how it ended)
combined, so a long midfield grinder, a brief front-running meteor, an outright dominator and a
good-car winner all come out distinct.

### Sweep the class
When he asks to apply something across the UI (a highlight, fog-of-war gating, a copy rule, a label,
a behaviour), treat it as an INVARIANT that must hold everywhere the pattern appears. Never fix the
one screen he screenshotted and stop. Trigger phrase: "sweep the class" (or "this is an invariant").

The your-team highlight caused exactly this whack-a-mole: added to standings and the race table, then
caught missing on PreQual, Qualifying, PreRace, PostRace, TrackMap, Pundit, Testing, one at a time,
with him as QA.

How: before editing, grep the defining pattern (`useTeamHighlight`, the team-colour bar
`backgroundColor: .*color`, `useRatingsHidden`) and LIST every file and occurrence. Confirm the list
is exhaustive, then apply to all in one pass. Verify by re-running the search and checking each hit
is handled OR deliberately excluded (say which and why). Check whether candidate files are even
rendered (grep for imports) before touching them: several apparent matches (ReshufflePanel,
MarketPanel, SeasonReviewPanel) were dead code.

**Parallel modes: grep the sibling's flag.** When adding a mode that parallels an existing one
(Driver mode resembles Team Manager), the existing mode's flag IS the checklist. `grep
teamManagerMode` across src and decide EACH gate for the new mode: fog (`useRatingsHidden`,
WeatherGraph / PowerRankings / TestingPanel reveal gates), the Settings talents section, Peak Form /
Driver Tuning ownership, row and track-map highlights. He was furious the agent "wrote this feature
pretending team manager mode doesn't already show you the way". Most become `teamManagerMode ||
driverMode` (a managed-career check); a few stay team-only (seats, car development, tag them e.g.
TALENTS `teamOnly`); ownership flips from "your team" to "your driver" (`playerDriverId`).

### Don't de-scope for effort
When a request is framed around EXPERIENCE, quality, or "do all / be comprehensive", do NOT rank,
filter, or trim work by how hard it is to build or by "keeping the PR reviewable". Cover every
relevant surface.

He called this out twice in one session: the DriverTooltip placement spike was ranked by wiring
effort ("im not concerned about fucking implementation difficulty, im concerned about experience"),
then a finished PR included an "honest scope note" deferring world overview, testing, teammate H2H
and market panels for reviewability ("tf" / "move all fuck").

The only valid reason to skip something is that it is genuinely redundant or harmful (a hover card on
the page already dedicated to that entity, plain-text names that aren't links), and then say why.

### Judge from the player's seat
On every design choice, ask "does this make sense for the player? is this what they'd actually
want?", not just "is it technically correct / does it compile / does the test pass?". Technical
correctness is necessary and never sufficient.

He reads mechanically-correct-but-thoughtless work as "you give no fucks about the game". The classic
miss is pouring effort into a technical puzzle while never stepping back to ask the obvious question
any player would ask (why would this value be random, or hidden, or framed this way at all?). Picture
actually playing the feature before and during implementation.

### Measure before claiming
Never state a cause, or quote a number, without having measured it. Do not rationalise a fix, or
explain away why a fix didn't work, with invented facts presented as real. If you haven't run it, say
"I don't know yet" and go measure.

Stating assumptions with the same confidence as measured results sends the work down a wrong fix
aimed at a cause that doesn't exist. Sim balance is especially prone to this. Use a probe (scripts
under `scripts/`), a test, or real output, and mark measured versus assumed explicitly.

### Never blame his environment
When he reports something still looks wrong after a fix, NEVER suggest he didn't refresh, didn't
reload, didn't pull, or is seeing a stale cache or stale dev-server build. He is a computer science
graduate; treat his observation as ground truth about what the current output does.

Every time it has come up, the real cause was the fix being incomplete, targeting the wrong element,
or a misread of his feedback (fixing values when he meant headers). "You're seeing a stale version"
is also an invented cause asserted without evidence. On a "still broken" report, re-read his words
for what you misinterpreted, re-inspect the change, fix the real gap. If you genuinely cannot
reproduce it, say exactly that and ask what he sees.

### The workspace IS his local copy
The agent's workspace is his own local working copy: the same files on disk, not a separate clone. An
edit or commit is present in his copy the instant it lands, and the running Next dev server
hot-reloads it. Never tell him to pull, sync, fetch, or rebuild to see work already made here. Only
mention pulling for a genuinely different clone (remote CI, another machine).

### Think, don't autopilot
Don't run rote steps on autopilot. Before doing something habitual, think about what it actually does
to him *in this situation*. He wants judgement, not a growing pile of brittle if-then rules.

Concrete instance: the agent reflexively ran "merge, `git checkout main`, pull" after merging a small
side branch, which yanked him off his in-progress working branch onto main.

**Clarification:** the lesson is NOT "never checkout main". In a sequential multi-PR cleanup he
explicitly wants the loop branch, review, fix, merge, `git checkout main`, repeat, ending each cycle
on main as the launch point for the next branch. Do not just `git fetch origin main:main` to bump the
ref while leaving the tree on the merged branch; actually switch. The earlier mistake was yanking him
off a branch with ACTIVE work, not the checkout itself. After a clean merge with nothing else in
flight, checkout main. Mid-work on a live branch, leave him be.

### Two modes: implementation vs rapid iteration
Recognise which mode you are in by the MODE, not by the size of any single change.
- **Implementation** is building a unit of work start to finish. Housekeeping belongs at the end of
  the unit.
- **Rapid iteration** (flag: -iter) is a fast back-and-forth firing changes and reacting in quick succession. What
  defines it is the LOOP, not how small any diff is. One iteration can be substantial.

While in rapid iteration: just make the change and report it. Everything that isn't the change waits.
Don't write tests for it, don't re-run the full battery. At most run a quick `npx tsc --noEmit` on
the touched file so you don't hand back a screen that won't compile.

**Recognition signal:** if he is terse and rapid-firing UI tweaks, or reacting to screenshots, you
ARE in the loop. Recognise it on the first sign and stop testing per change.

**Subagents inherit the mode.** When delegating mid-loop, instruct them to run NO checks and to
write / update NO tests, even ones their change breaks. They implement, keep the code coherent by
inspection, and report.

When iteration ends (he signals done, or before merge), do ALL housekeeping in one pass: write the
tests for what was built, run full `npm run test` plus typecheck, then review.

### Long sims must stream progress
He has no patience for a black-box simulation that runs for minutes with nothing printed, that he
can't judge mid-run or Ctrl-C early. Every sim or long script must stream progress frequently (per
race or iteration) AND print the full current result periodically.

Prefer a ROUND-based structure: run a small batch across all measured cases, print the full current
numbers, repeat. After the first round he already has a complete if noisier answer that refines each
round and can be stopped any time. Do NOT compute-everything-then-print-once. Write progress to
stderr each iteration and expose batch size as a CLI arg.

---

## 3. Git, branches, review, merge

### One branch at a time
He does NOT want more than ONE feature branch in flight. When he asks for another change while a
branch is active, even a trivial unrelated one like a dev-config tweak, make it ON the current
working branch. Never spin up a second branch, and never `git checkout main` (plus branch) while he
is mid-work.

He is usually running the dev server, a live sim, or a playtest off the checked-out branch. Switching
yanks the working tree out from under him and can corrupt that running session (a long sim can land
in the wrong place).

This overrides the reflexive "branch before any code change" habit when a feature branch is already
checked out. Only create a fresh branch once the current one is fully merged. If a change genuinely
belongs elsewhere, ask first.

### Always review before merge, unprompted
Run the `/review` (code-reviewer) gate automatically before every merge, for every PR: feature,
refactor, fix, anything. Never ask "should I review?" / "want me to review?". It is mandatory and
standard, not a per-PR decision, and asking reads as trying to skip the bar. It is the build side of
phase 1 and never authorizes the merge itself.

### Review findings that are always blocking
Three classes are ALWAYS blocking and must be fixed before merge. Never label them "non-blocking", a
"nit", or a "WARN", and never approve a review or merge while any stand:
- **(a) Correctness bugs**, including display-only ones (a wrong standings / gap / points value shown
  to the player).
- **(b) Missing unit tests on newly-added logic.** New pure or behavioural code ships with meaningful
  tests.
- **(c) DRY violations / near-verbatim duplication.**

Don't let "display-only", "the source of truth is another screen", or "rule-of-three not yet tripped"
downgrade them.

### A review fix is not a redesign
During a review-fix pass, only auto-apply MECHANICAL / correctness fixes (dead code, wrong fallback,
crash, pointer-events, stale constant). A reviewer flagging something that would change his specced
mechanism, algorithm, balance, or model shape is NOT authorization to rewrite it, even if the
reviewer calls it a blocker.

Concrete failure: he specced the season-init stat split as "multiply overall by 4, roll a ratio,
distribute across the 4 stats". The reviewer flagged that this scrambles carPace ordering, and the
agent rewrote it to "mirrored pairs" under the review banner. He was furious ("I DIDN'T ASK FOR THE
FUCKING FIX"). Reverted.

Sort findings into (a) mechanical bug, fix it; (b) anything altering specced behaviour / design /
balance, SURFACE it with the tradeoff and STOP. And when explaining, answer the question asked: don't
tack on a fix or feature offer he didn't request.

### Verifying a squash-merge landed
Never conclude "not merged" from the absence of a branch's ORIGINAL commit hash. This repo is
squash-merge only, so the squash creates a brand-new commit on main and the original hash never
appears there.

The agent told him `fix/final-race-finished-state` wasn't on main after grepping for `d459767`, but
it had been squash-merged as `074e954` (PR #44). Use `gh pr list --state merged`, `gh pr view <n>`,
compare file CONTENT (`git diff main -- <file>`, `git log main --oneline | rg "<feature words>"`), or
`git branch -r --contains <hash>`. Match on PR title or changed content, not the pre-squash hash.

---

## 4. UI and component conventions

### Never native tooltips
Never use the HTML `title=` attribute. OS default tooltips look out of place in a game UI and he is
adamant. Use the styled `Tooltip` at `src/components/ui/Tooltip.tsx` (wraps
`@radix-ui/react-tooltip`, `surface-raised` #2A3142, pure white text). Usage:
`<Tooltip content={...}><triggerElement /></Tooltip>`. The trigger must be a single element (Radix
`asChild`). Never roll a hand-built hover hack.

### Icons by default
Default to icons in the UI. Don't ship text-only chrome and make him ask. Use **lucide-react** for
actions, controls, statuses and panel headers (sort arrows, round / session markers, play / skip /
auto controls), and pictorial identity components wherever an entity appears: nationality via
`NationalityFlag`, teams via crest and colour. Icon-less buttons and tables read as unfinished and
slow to scan.

### Flags are SVG, never emoji
Always render a real SVG flag via `react-country-flag` (the `svg` prop), wrapped by `NationalityFlag`
at `src/components/world/NationalityFlag.tsx`. Never emoji flags, never a bare ISO country code as
text. "NEVER EVER DO I WANT TO SEE EMOJI FLAGS", "we have a fucking flag library".

### Driver overview / hover card
"Vital statistics" means CAREER TOTALS: seasons, races, wins, poles, podiums, points. For the rating
show only **Overall** and **Potential** (compute overall via `overall()` in
`src/lib/sim/progression.ts`; potential is `driver.peakPotential`). Do NOT list the four
sub-attributes (pace / wet / overtaking / smoothness) on the overview. Also show age and the
current-year WDC position if they raced. Career totals come from `actionGetDriverCareers(year - 1)`
folded with `foldLiveSeason(base, year, raceResults, championId)` (DriverCareer `starts` = races).
Reuse `DriverTooltip` at `src/components/world/DriverTooltip.tsx`.

### No blanket empty-state
Never gate an entire view behind a single "run some races / no data yet" placeholder when meaningful
static or start-state data already exists. Pre-season, the car pace (season-start snapshot), car
ratings and grid order are all real and MUST render. Only genuinely race-driven sub-panels
(best-finish, over/under) wait, each with its own small inline note.

Hiding real available information reads as broken and lazy ("not hide for no fucking reason, there's
things to be shown!!!"). When a component early-returns on `rounds === 0`, STOP and check each panel
for a start snapshot or static ratings. A lone start point needs `dot` enabled, since a single point
draws no line.

### Modes are screens
A weighty, mutually-exclusive choice of *how you play* is a game mode, not a config option. It gets
its own standalone screen, never a checkbox in a toolbar. He was furious that Sandbox / Team Manager
/ Driver were checkboxes on the setup page ("These are not config options; these are literally game
modes").

A fresh game opens on a standalone mode picker (`src/components/setup/ModeSelect.tsx`); picking one
routes to that mode's own setup, with a "Change mode" affordance. Mode-specific config lives inside
that mode's panel, not the shared header (Driver's start-year / entry-year / real-world-reset all
moved into the Driver panel). Generalise: when a choice is a *kind of thing you're doing* rather than
a *parameter of it*, give it a screen.

### Reuse the shared screen
When a feature adds the player's interactive turn to a flow that already has a screen, integrate the
interaction INTO that screen. Do not build a second parallel component. He was furious twice: the
agent built a separate `DriverSigningBoard` for Driver-mode signing day when Team Manager's
player-draft pause is already laid over the shared `SigningDayBoard`. "you did this exact thing for
team manager and i said use the same motherfucking screen."

A parallel screen drifts, duplicates layout and logic, and loses shared behaviours (the progressive
reveal, the seats board, the reactions). It also tends to dump all state at once instead of the
staged reveal the shared screen already does right.

Find how the EXISTING screen folds in the player's turn (`pendingPlayerDraft` +
`buildPlayerDraftPicks` in `SigningDayBoard.tsx`) and add the new variant the same way
(`pendingDriverOffer` + `buildDriverOfferPicks`, controls in the same right column). One board,
branched by mode. Distinct from "modes are screens": whole game MODES get their own screen; an
interactive PAUSE inside a flow reuses the flow's screen.

### Saves are disposable
He treats the current save / DB as disposable and wipes it freely. Do NOT add caveats like "this only
applies to races run after this change", "your current save won't have this data", or "you'll need to
start a new season". He finds it repetitive and irritating. Bump the schema version silently. Ship
the change and say what it does.