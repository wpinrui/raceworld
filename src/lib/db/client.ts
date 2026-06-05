import Database from 'better-sqlite3'
import path from 'path'
import { SCHEMA } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    // The packaged desktop app sets RACEWORLD_DB_DIR to a writable per-user directory (Electron's
    // userData); process.cwd() is read-only / unpredictable inside a portable exe. Falls back to cwd
    // for `next dev` and the CLI scripts.
    const dir = process.env.RACEWORLD_DB_DIR || process.cwd()
    const dbPath = path.join(dir, 'raceworld.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
  }
  return db
}
