# Templated newsroom

FM-style news, generated from game state. **No LLM, no API cost.** `generateNews(ctx)` in
`engine.ts` is a pure function of a `NewsContext`. Wording is deterministic: every article
picks its template variant from a seeded hash of its id, so the feed is stable across renders
(no flicker, no regeneration).

## Variety without an LLM

Bodies are assembled by `compose()` (in `util.ts`) from **independent fragment pools** —
opener × detail × closer. A paragraph built from two pools of ~8 fragments is 64 distinct
paragraphs; a body of four or five such paragraphs runs into the thousands of combinations
from a couple hundred authored strings. Each pool seeds its pick off the article id, so the
same article always reads the same way, but article-to-article the prose varies. Headlines and
deks pick from ~8–14 variants each. **Every article is built to reach at least five
sentences** (`paras()` joins composed paragraphs and drops any that collapsed to empty). Net
effect: the feed reads written, not stamped, across a 24-race season.

## Cadence (not every category every race)

| Category | Producer | Cadence / trigger |
|---|---|---|
| `race_report` | raceReports | **Every race.** One consolidated report: winner + podium + margin, the start (pole / drive of the day), attrition (DNFs), and the title picture. Result, incident, retirement and championship all live *inside* this piece. |
| `milestone` | milestones | **Per race, on a genuine first.** First win of the season for a driver, a surprise podium (a non-top-pace car reaching the rostrum, first of its year — live only), or a team 1-2. Naturally rare. |
| `technical_upgrade` | technicalRoundup | **Per race, only if someone upgraded.** One roundup grouping every team's package that round (delivered vs misfired). |
| `championship_state` | championship | The clinch moments only — driver + constructor titles, emitted at the round they were mathematically secured. |
| `championship_state` | titleFight | Final third of the calendar, gap ≤ a catchable margin, gated — the run-in gets coverage round by round. |
| `feature` | features | A long state-of-the-season read at half-distance, and a season review once the final round is in. Grounded in the standings to date. |
| `preview_schedule` | previews | A run-up piece for **every round** (off the standings as they stood beforehand), plus the upcoming round while live. |
| `preview_schedule` | preSeason | Pre-season season preview (live only). |
| `car_launch_livery` / `rookie_debut` | preSeason | Pre-season launches per team + youngest-driver spotlights (live only). |
| `driver_signing` / `driver_exit` / `career_retirement` | market | End-of-season `marketMoves` / `droppedDrivers` / `retiredDriverIds`. |
| `silly_season` | sillySeason | **Three windows only** — mid-season, three-quarter distance, penultimate round. See below. |
| `analysis_opinion` | analysis | **At most one per round.** Every angle (teammate imbalance, form slump, form surge / hot streak, team over/under-performance) is scored for newsworthiness; subjects featured in the last few rounds take a small penalty; the single best candidate runs if it clears a bar. Trajectory angles are live-only (need car pace). |

## Silly season is a real projection

`sillySeason` doesn't hand-wave the rumours. At each window it takes the season-to-date,
computes every driver's media rating (`computeDriverMediaScores`), applies a **seeded
−10..+10 error** to each, then runs the actual driver-market sim (`runDriverMarket`, with
`computeTeamMediaScores` + `computeRetentionDeltas`) one season forward. The genuine team
switches it produces become the speculation; a quiet projection becomes a "quiet market"
piece. Same season state always projects the same rumours (seeded RNG).

## Multi-season

The page has a season selector (newest first; the live season pinned to the top). The **live**
season is generated client-side from the store with full attributes. **Past** seasons are
rebuilt from the archive DB by `actions.ts` (`actionGetSeasonNews`) — results only, so
`live: false` stands down the attribute-dependent producers (trajectory, silly-season). Past
seasons therefore carry race reports, clinches, title-fight, previews and results-based
analysis.

## Out of scope (deliberately not generated)

From the headline research, these real-world categories have no in-game hook and are skipped:
media features (podcasts/videos/quizzes/interviews), other racing series, F1 games, obituaries,
real-world governance/legal. The game reports *events*, not coverage of coverage.

## Adding templates

- More variety: add strings to any `compose()` pool or the headline/dek arrays — the seeded
  picker uses them automatically.
- New category: add a producer returning `NewsArticle[]`, register it in `generateNews`, and add
  a `CATEGORY_LABELS` entry. Keep facts sourced from `ctx` only (no invented numbers); gate
  flavour pieces with `chance()`; respect `ctx.live` for anything needing real attributes.
- Avoid em dashes in copy.
