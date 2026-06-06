import Database from 'better-sqlite3'
import path from 'path'
import { SCHEMA } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'raceworld.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    // Pre-launch we don't preserve local DB data (see save policy): if a carried-over
    // driver_race_attributes is missing a newly-added rating column, drop and recreate it rather
    // than migrate. CREATE TABLE IF NOT EXISTS can't add columns to an existing table on its own.
    const cols = db.prepare('PRAGMA table_info(driver_race_attributes)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'consistency')) {
      db.exec('DROP TABLE IF EXISTS driver_race_attributes')
      db.exec(SCHEMA)
    }
  }
  return db
}
