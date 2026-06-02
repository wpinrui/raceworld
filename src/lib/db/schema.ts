export const SCHEMA = `
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  round INTEGER NOT NULL,
  circuit_id TEXT NOT NULL,
  circuit_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming'
);

CREATE TABLE IF NOT EXISTS race_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL REFERENCES races(id),
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  grid_position INTEGER NOT NULL,
  finish_position INTEGER,
  points INTEGER NOT NULL DEFAULT 0,
  laps_completed INTEGER NOT NULL,
  total_time_ms REAL,
  dnf INTEGER NOT NULL DEFAULT 0,
  stints_json TEXT NOT NULL DEFAULT '[]',
  q1_time_ms REAL,
  q2_time_ms REAL,
  q3_time_ms REAL
);

CREATE TABLE IF NOT EXISTS season_constructor_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  team_id TEXT NOT NULL,
  final_position INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, team_id)
);

-- Post-race snapshot of each driver's four attributes, for the career ratings-progression
-- chart. One row per (season, round, driver). round is 1-indexed (no pre-season baseline here;
-- the live store carries round 0 for the in-progress season).
CREATE TABLE IF NOT EXISTS driver_race_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  round INTEGER NOT NULL,
  driver_id TEXT NOT NULL,
  pace REAL NOT NULL,
  wet_weather_pace REAL NOT NULL,
  overtaking REAL NOT NULL,
  smoothness REAL NOT NULL,
  UNIQUE(season_id, round, driver_id)
);

-- Per-race pre-race form (0-10), for the Recent form card. Keyed by the race row so it
-- joins back to grid/finish/points for the tooltip.
CREATE TABLE IF NOT EXISTS driver_race_form (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL REFERENCES races(id),
  driver_id TEXT NOT NULL,
  form REAL NOT NULL,
  UNIQUE(race_id, driver_id)
);

-- LLM-generated newsroom articles (M5). One row per (type, year, round); round is null
-- for non-race articles. Natural key gives idempotent upsert + dedup. On-demand searches
-- are NOT stored here.
CREATE TABLE IF NOT EXISTS news_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  season_id INTEGER,
  year INTEGER NOT NULL,
  round INTEGER,
  headline TEXT NOT NULL,
  dek TEXT,
  body TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type, year, round)
);
`
