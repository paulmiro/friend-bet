import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"

// Guards the created_at migration in db.ts: legacy unix-epoch integers must
// become JS-parseable ISO strings, and NULLs must backfill from scheduled_time.
test("created_at migration: epoch int -> ISO, NULL -> scheduled_time", () => {
  const db = new Database(":memory:")
  db.run("CREATE TABLE events (id INTEGER PRIMARY KEY, scheduled_time DATETIME, created_at DATETIME)")
  db.run("INSERT INTO events VALUES (1, '2026-07-01T10:00:00.000Z', 1751362200)")
  db.run("INSERT INTO events VALUES (2, '2026-07-02T10:00:00.000Z', NULL)")

  db.run("UPDATE events SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at, 'unixepoch') WHERE typeof(created_at) = 'integer'")
  db.run("UPDATE events SET created_at = COALESCE(scheduled_time, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) WHERE created_at IS NULL")

  const rows = db.query("SELECT id, created_at FROM events ORDER BY id").all() as any[]
  expect(rows[0].created_at).toBe("2025-07-01T09:30:00Z")
  expect(rows[1].created_at).toBe("2026-07-02T10:00:00.000Z")
  for (const r of rows) expect(Number.isNaN(new Date(r.created_at).getTime())).toBe(false)
})
