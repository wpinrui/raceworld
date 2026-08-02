# RaceWorld — Dev Reference

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS · better-sqlite3 · Zustand · Anthropic SDK · Lucide React

## Architecture
- **Race simulation** runs entirely client-side as a Zustand store. No DB writes mid-race; flush to SQLite at race end via Server Action.
- **Played races run the live engine** (#live-engine): `LiveRace` (src/lib/sim/live.ts) steps the world in fixed 0.5 s race-seconds, holding each car as a continuous position (laps + fraction) driven by the lap model's `freeAirPace`. `useLiveRace` drives it from a rAF loop and projects into the Zustand store at 4 Hz; store commands reach the engine through `live-bridge.ts`. The 2D map samples the engine directly per frame.
- **Two tick granularities, one core** (#sector-engine): `simulateSlice` (src/lib/sim/slice.ts) advances the field by a fraction of a lap. `simulateSector`/`tickSector` remain for the parity probe and tests, NOT for played races. Headless racing (sim-ahead fast-forward, probe scripts) calls `simulateLap`, a frac=1 delegate that is bit-compatible with the historical lap engine — race.test.ts's seeded snapshot locks it. Statistical parity between the two is measured by `npx tsx scripts/sector-parity.ts` (paired-seed races, streamed metrics); the scaling rules (probability rescale, per-lap atomic decisions at lap boundaries, one pass per car per lap) live in slice.ts/engine.ts comments.
- **Stats engine** lives server-side: SQL queries via Server Actions, called from Standings and Newsroom screens.
- **Newsroom LLM** is a Server Action calling Claude with tool-calling against the stats DB. API key never leaves the server.

## Folder structure
```
src/
  app/                  # Next.js App Router pages (one folder per screen)
    setup/
    standings/
    home/
    newsroom/
    race/
  components/           # Shared UI components
  lib/
    sim/                # Simulation engine (lap time, tyres, weather, overtaking)
    db/                 # SQLite schema, queries, Server Actions
    store/              # Zustand stores
    ai/                 # Anthropic tool definitions and newsroom logic
  data/
    2026-grid.ts        # Pre-populated 2026 F1 teams, drivers, attributes
    calendar.ts         # 2026 race calendar with per-circuit modifiers
```

## Milestones

### M1 — Single race with in-race god mode
Single hardcoded 2026 grid. Qualifying → race simulation screen → results.
Covers: simulation engine, qualifying, commentary, pit AI, in-race god mode (tyre wear, forced retirement, form modifier), basic results display.

### M2 — Full season loop
Covers: Setup/Drivers screen (CRUD, pre-populate 2026 grid, local import), 2026 calendar, season flow (pre-race → qualifying → race → end-of-season), standings screen with colour coding, points system, SQLite schema and raw stats collection.

### M3 — Multi-season dynamics
Covers: driver progression curves, car development cycles, funding tiers, end-of-season reshuffle, driver market (contracts, free agency, retirement, media score algorithm).

### M4 — Season-level god mode + home screen + stats engine
Covers: contract overrides, forced releases, dev cycle and narrative modifier overrides, home screen, stats engine feats/records detection.

### M5 — Newsroom
LLM integration. Routine articles (race review, season preview, partial season report). On-demand search with Claude tool-calling against stats DB.

## Running locally
```bash
npm run dev       # start dev server
npm run db:init   # initialise SQLite schema (run once after clone)
```

## Env vars
```
ANTHROPIC_API_KEY=   # required for M5 only
```
