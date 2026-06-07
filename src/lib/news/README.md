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
deks pick from ~8–14 variants each. Net effect: the feed reads written, not stamped, across a
24-race season.

## Cadence (not every category every race)

| Category | Producer | Cadence / trigger |
|---|---|---|
| `race_report` | raceReports | **Every race.** One consolidated report: winner + podium + margin, the start, attrition (DNFs), the weather angle (wet races), and the title picture. Its closing line is **trajectory-aware** — the running championship coda (#88) when the gap is swinging, else the static state. |
| `milestone` | milestones | **Per race, on a genuine first.** First win of the season for a driver, a surprise podium (live only), or a team 1-2. Naturally rare. |
| `technical_upgrade` | technicalRoundup | **Per race, only if someone upgraded.** One roundup grouping every team's package that round (delivered vs misfired). |
| `championship_state` | championship | The factual clinch + lead-change moments — driver + constructor titles, emitted at the round secured. |
| `championship_state` | championshipArc | **Sparse, in-season (#88).** The drivers' title-fight narrative — fires only at trajectory inflections (a lead eroding/extending, a decider, a lead change), telling a comeback-on-merit apart from one handed over by leader DNFs. Absorbed the old titleFight + titleScenario. |
| `championship_state` | constructorArc | **Sparse, in-season (#88).** Same inflection detection for the constructors' title (a shared arc-event core, `season-analysis.ts`). Priority just below the drivers' arc. |
| `feature` | seasonReview | **End of season (#88).** Pays off the preview: how the title was won, framed by the full championship-battle taxonomy (wire-to-wire / comeback-on-merit / comeback-handed / three-way / title-on-podiums / win-streak / domination / decider / clear), who beat or missed their projection, the best of the rest. Replaced the old `features` producer. |
| `feature` | driverArc | **End of season (#88).** The season's individual stories (top 3) — an overachiever dragging a lesser car to podiums, a preseason pick who flopped, a fast start that deflated, a rookie beating a veteran team-mate, a rookie podium, a late-career resurgence. From the archetype classifier (`archetypes.ts`). |
| `preview_schedule` | seasonPreview | **Round 0 (#88).** Introduces the season's protagonists across tiers (favourites, dark horses, best-of-the-rest, rookies, veterans, new teams) from the media-projection expectation model. Replaced the old pace-only preview blurb. |
| `preview_schedule` | previews | A run-up piece for **every round** (off the standings as they stood beforehand), plus the upcoming round while live. |
| `car_launch_livery` / `rookie_debut` | preSeason | Pre-season launches per team + youngest-driver spotlights (live only). |
| `driver_signing` / `driver_exit` / `career_retirement` | market | End-of-season `marketMoves` / `droppedDrivers` / `retiredDriverIds`. |
| `silly_season` | contractWatchFeature / renewalsFeature / offSeasonFeature | The free-agent market beats — contract-watch verdicts, the mid-season renewals round-up, and the end-of-season transfer recap. (The speculative rumour mill, `sillySeason`, was removed for quality, #92.) |
| `analysis_opinion` | expectationCheck | **~Twice a season (#88)** (one-third, two-thirds). Drivers and teams running above/below their PRESEASON projection — "who's cooking vs trash". Replaced the old `analysis` form-slump/surge + team-vs-car-pace angles. |
| `analysis_opinion` | teammateBattle | **End of season (#88).** The intra-team verdicts (top 2) — one driver routing the other on equal machinery, or the more-fancied driver beaten by the other side of the garage. From the archetype classifier; replaced the old `analysis` teammate-imbalance angle. |
| `analysis_opinion` | crossTeamDuel | **End of season (#88).** The season's single defining cross-team battle outside the title fight — a parallel fight among the fast cars, or a midfield duel. From the archetype classifier. |

## Season-long narrative (#88)

A pure `season-analysis.ts` pass derives the season's story once, and the preview / arc / coda /
review all read it:

- **Expectation model** — the media's *fallible* preseason view, deliberately distinct from true
  pace. Driver = last season's media score (→ `50 + pace/narrative` on the same 0-100 scale for
  rookies/returnees with no prior score); car = last season's constructors' finish (newcomers to
  the back; a save's first season falls back to raw car pace). Combination is **car-dominant**: the
  car sets the tier and base grid slot; the driver shifts it a bounded ~2 places (a z-score clamped
  to ±2σ), never a full tier.
- **Gap trajectory** (drivers' + constructors') with erosion / extension / decider detection and
  merit-vs-DNF framing; **tier** segmentation; **expectation-vs-actual** deltas.

The gap between projection and reality is the story engine: a team that was 5th but built a rocket
gets "projected midfield, delivering wins". Copy is authored to the project's hand-written newsroom
voice, grounds every fact in in-game aggregate stats, and limits texture to details the sim does
not model (so it can never be contradicted). Last season's driver media scores + season-start car
pace are carried into the live context (`season-store` carryover → `live-context`), and snapshotted
into the archive so past seasons keep the same feed.

## Multi-season

The page has a season selector (newest first; the live season pinned to the top). The **live**
season is generated client-side from the store with full attributes. **Past** seasons are served
from the snapshot captured at archival (`offseason-flow` → `actionSaveSeasonNews`); the
attribute-dependent producers (season narrative, analysis trajectory, market beats) can't be
rebuilt from results alone, so the snapshot preserves them. A results-only rebuild
(`actions.ts`, `live: false`) is the fallback when no snapshot exists, carrying race reports,
clinches, previews and results-based analysis.

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
