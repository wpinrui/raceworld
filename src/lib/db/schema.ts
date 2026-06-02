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
`
