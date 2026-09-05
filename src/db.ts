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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

// Freie Themen-Wetten: der Ersteller verteilt den Pot am Ende von Hand.
// Bewusst eigene Tabellen — mit den Pünktlichkeits-Events teilen sie sich
// weder Zeitpunkte noch Ausreden noch die Payout-Formel.
db.run(`
  CREATE TABLE IF NOT EXISTS topic_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER,
    description TEXT,
    status TEXT DEFAULT 'open',
    resolution_text TEXT,
    refund_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(creator_id) REFERENCES users(id)
  );
`)

db.run(`
  CREATE TABLE IF NOT EXISTS topic_bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_event_id INTEGER,
    user_id INTEGER,
    answer TEXT,
    amount INTEGER,
    payout INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(topic_event_id) REFERENCES topic_events(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`)

try {
  db.run("ALTER TABLE events ADD COLUMN cancel_reason TEXT")
} catch {}

// Für die gemeinsame Sortierung mit topic_events. Altbestand bleibt NULL,
// das Frontend fällt dort auf scheduled_time zurück.
try {
  db.run("ALTER TABLE events ADD COLUMN created_at DATETIME")
} catch {}

console.log("📁 Database initialized.")
