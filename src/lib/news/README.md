# Templated newsroom

FM-style news, generated from game state. **No LLM, no API cost, no DB** — `generateNews(ctx)`
in `engine.ts` is a pure function of a `NewsContext` (built from the live season store +
calendar). Wording is deterministic: every article picks its template variant from a seeded
hash of its id, so the feed is stable across renders (no flicker, no regeneration).

## How it works

- Each **producer** in `engine.ts` is a news category. It inspects the context and emits zero
  or more `NewsArticle`s. Its leading comment states the **trigger**.
- `art(id, category, round, priority, headlines[], deks[], bodies[], slots)` renders one
  article: it picks a headline/dek/body variant (seeded by `id`) and fills `{slot}` tokens.
- **Flavour** pieces (opinion, rumour, incident colour) additionally pass a seeded
  `chance(id, pct)` gate, so not every eligible condition fires every round — but the same
  condition always resolves the same way. This is the "random event conditioned on something".
- `round` is the chronological sort key: `0` = pre-season, `1..N` = races, `N+1` = off-season.
  The feed is newest-first (`round` desc, then `priority`).

## Categories and their triggers (all from data we already have)

| Category | Producer | Trigger (data condition) |
|---|---|---|
| `race_review` | raceReviews | every completed round → the winner + podium; margin from `totalTime` gaps |
| `qualifying` | qualifying | every completed round → the pole-sitter (`gridPosition === 1`) |
| `reliability_dnf` / `crash_incident` | retirements | any `dnf` driver in a round (reliability-vs-incident framing chosen by seeded coin-flip) |
| `technical_upgrade` | upgrades | a `DevUpgradeEvent` delivered that round (M3 dev cycles); `failed` flips the angle |
| `championship_state` | championship / titleFight | standings after the latest round: leader + gap; clinch when gap > remaining × 25 (43 for WCC); a "down to the wire" piece in the final third when the gap is small |
| `preview_schedule` | preview / preSeason | an upcoming round exists (season ongoing); plus a pre-season season-preview |
| `car_launch_livery` | preSeason | pre-season (no rounds run) → one launch piece per team |
| `rookie_debut` | preSeason | pre-season → the youngest grid drivers (age ≤ 22) |
| `driver_signing` | market | end-of-season `marketMoves` (move or re-signing) |
| `driver_exit` | market | end-of-season `droppedDrivers` |
| `career_retirement` | market | end-of-season `retiredDriverIds` |
| `silly_season` | sillySeason | mid-season, a driver with `contractExpiresAfterSeason <= year` (gated) |
| `analysis_opinion` | teammateBattles | teammate out-scored by ≥20 pts (gated) |
| `analysis_opinion` | formSlumps | a driver's last-3 average finish outside the top 12 (gated) |
| `analysis_opinion` | teamTrajectory | constructor standing position vs car-pace rank differs by ≥2 (over/under-performing, gated) |

## Out of scope (deliberately not generated)

From the headline research, these real-world categories have no in-game hook and are skipped:
media features (podcasts/videos/quizzes/interviews), other racing series, F1 games, obituaries,
real-world governance/legal. The game reports *events*, not coverage of coverage.

## Adding templates

- More variety: add strings to a producer's `headlines`/`deks`/`bodies` arrays — the seeded
  picker uses them automatically.
- New category: add a producer returning `NewsArticle[]`, register it in `generateNews`, and add
  a `CATEGORY_LABELS` entry. Keep facts sourced from `ctx` only (no invented numbers), and gate
  flavour pieces with `chance()`.
- Avoid em dashes in copy.
