import { Database } from "bun:sqlite"
import path from "node:path"
import { cwd } from "node:process"

const dbPath = path.join(
  process.env.FRIEND_BET_DB_LOCATION || ".",
  "friend-bet.db",
)
export const db = new Database(dbPath, { create: true })

// Initialize Database Schema
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    balance INTEGER DEFAULT 100
  );
`)

db.run(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER,
    description TEXT,
    scheduled_time DATETIME,
    actual_arrival_time DATETIME,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY(creator_id) REFERENCES users(id)
  );
`)

db.run(`
  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    user_id INTEGER,
    amount INTEGER,
    bet_arrival_time DATETIME,
    excuse TEXT,
    payout INTEGER DEFAULT 0,
    bonus_given INTEGER DEFAULT 0,
    FOREIGN KEY(event_id) REFERENCES events(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`)

try {
  db.run("ALTER TABLE events ADD COLUMN cancel_reason TEXT")
} catch {}

// ponytail: created_at stored as ISO string like every other date column; insert sets it explicitly.
try {
  db.run("ALTER TABLE events ADD COLUMN created_at DATETIME")
} catch {}

// migrate legacy unix-epoch integers -> ISO string, then backfill NULLs from scheduled_time or now.
db.run(
  "UPDATE events SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at, 'unixepoch') WHERE typeof(created_at) = 'integer'",
)
db.run(
  "UPDATE events SET created_at = COALESCE(scheduled_time, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) WHERE created_at IS NULL",
)

console.log("📁 Database initialized.")
