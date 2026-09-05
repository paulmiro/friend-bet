import { serve } from "bun"
import { db } from "./db"
import { splitAcrossBets } from "./payout"
import indexHtml from "./index.html"

const FRIEND_NAME = process.env.FRIEND_BET_NAME
if (!FRIEND_NAME) {
  console.error("❌ FRIEND_BET_NAME environment variable is required.")
  process.exit(1)
}

// Optional. Wer hier drinsteht, darf fremde Events verwalten und Konten
// bearbeiten. Bewusst nur eine Umgebungsvariable — in der DB steht nirgends,
// wer Admin ist, und ohne die Variable gibt es schlicht keinen.
const ADMIN_NAME = process.env.FRIEND_BET_ADMIN

const isAdmin = (userId: unknown) => {
  if (!ADMIN_NAME) return false
  const user = db
    .prepare("SELECT username FROM users WHERE id = ?")
    .get(userId as any) as any
  return !!user && user.username.toLowerCase() === ADMIN_NAME.toLowerCase()
}

const server = serve({
  port: parseInt(process.env.FRIEND_BET_PORT || "3000"),
  routes: {
    "/*": indexHtml,

    "/ws": {
      async GET(req, server) {
        if (server.upgrade(req)) {
          return
        }
        return new Response("Upgrade failed", { status: 500 })
      },
    },

    "/api/login": {
      async POST(req) {
        const { username } = await req.json()
        if (!username)
          return Response.json({ error: "Username required" }, { status: 400 })

        let user = db
          .prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)")
          .get(username) as any

        if (!user) {
          const info = db
            .prepare("INSERT INTO users (username) VALUES (?)")
            .run(username)
          user = { id: info.lastInsertRowid, username, balance: 100 }
        }
        return Response.json(user)
      },
    },

    "/api/me/:id": async (req) => {
      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(req.params.id)
      return Response.json(user)
    },

    "/api/leaderboard": async (req) => {
      // Normalerweise nur Mitspieler mit abgeschlossenen Wetten. Ein Admin
      // sieht zusätzlich die inaktiven Konten (active = 0).
      const adminId = new URL(req.url).searchParams.get("admin_id")
      const showAll = adminId !== null && isAdmin(adminId)

      const leaderboard = db
        .prepare(`
          SELECT id, username, balance, active FROM (
            SELECT u.id, u.username, u.balance,
              CASE WHEN EXISTS (
                SELECT 1 FROM bets b
                JOIN events e ON b.event_id = e.id
                WHERE b.user_id = u.id AND e.status = 'closed'
              ) OR EXISTS (
                SELECT 1 FROM topic_bets tb
                JOIN topic_events te ON tb.topic_event_id = te.id
                WHERE tb.user_id = u.id AND te.status != 'open'
              ) THEN 1 ELSE 0 END as active
            FROM users u
          )
          WHERE ? = 1 OR active = 1
          ORDER BY balance DESC, username ASC
        `)
        .all(showAll ? 1 : 0)
      return Response.json(leaderboard)
    },

    "/api/stats/:id": async (req) => {
      const userId = req.params.id
      const stats = db
        .prepare(
          `
        SELECT 
          COUNT(*) as total_bets,
          SUM(amount) as total_wagered,
          SUM(payout) as total_payout,
          (SELECT COUNT(*) FROM bets b2 JOIN events e ON b2.event_id = e.id WHERE b2.user_id = ? AND e.status = 'closed') as resolved_bets
        FROM bets 
        WHERE user_id = ?
      `,
        )
        .get(userId, userId)

      const topicStats = db
        .prepare(
          `
        SELECT
          COUNT(*) as total_bets,
          SUM(amount) as total_wagered,
          SUM(payout) as total_payout,
          (SELECT COUNT(*) FROM topic_bets tb2 JOIN topic_events te ON tb2.topic_event_id = te.id WHERE tb2.user_id = ? AND te.status != 'open') as resolved_bets
        FROM topic_bets
        WHERE user_id = ?
      `,
        )
        .get(userId, userId) as any

      const history = db
        .prepare(
          `
        SELECT
          b.*,
          e.description as event_description,
          e.actual_arrival_time,
          e.scheduled_time,
          e.created_at,
          e.status as event_status
        FROM bets b
        JOIN events e ON b.event_id = e.id
        WHERE b.user_id = ?
        ORDER BY b.id DESC
      `,
        )
        .all(userId) as any[]

      const topicHistory = db
        .prepare(
          `
        SELECT
          tb.*,
          te.description as event_description,
          te.resolution_text,
          te.refund_reason,
          te.status as event_status
        FROM topic_bets tb
        JOIN topic_events te ON tb.topic_event_id = te.id
        WHERE tb.user_id = ?
        ORDER BY tb.id DESC
      `,
        )
        .all(userId) as any[]

      const add = (a: number | null, b: number | null) => (a || 0) + (b || 0)
      const mergedStats = {
        total_bets: add((stats as any).total_bets, topicStats.total_bets),
        total_wagered: add(
          (stats as any).total_wagered,
          topicStats.total_wagered,
        ),
        total_payout: add((stats as any).total_payout, topicStats.total_payout),
        resolved_bets: add(
          (stats as any).resolved_bets,
          topicStats.resolved_bets,
        ),
      }

      // Pünktlichkeits-Wetten haben keinen eigenen Zeitstempel; für die
      // gemeinsame Sortierung tut es das geplante Datum des Events.
      const sortKey = (row: any) =>
        row.created_at ?? row.scheduled_time ?? "0000"
      const mergedHistory = [
        ...history.map((row) => ({ ...row, kind: "punctuality" })),
        ...topicHistory.map((row) => ({ ...row, kind: "topic" })),
      ].sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1))

      return Response.json({ stats: mergedStats, history: mergedHistory })
    },

    "/api/events": {
      async GET() {
        const events = db
          .prepare(
            `
          SELECT events.*, users.username as creator_name 
          FROM events 
          JOIN users ON events.creator_id = users.id 
          ORDER BY events.id DESC
        `,
          )
          .all()
        return Response.json(events)
      },
      async POST(req) {
        const { creator_id, description, scheduled_time } = await req.json()
        // created_at explizit: bei migrierten DBs hat die Spalte keinen
        // Default (SQLite erlaubt das bei ALTER TABLE nicht).
        const info = db
          .prepare(
            "INSERT INTO events (creator_id, description, scheduled_time, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
          )
          .run(creator_id, description, scheduled_time)

        const newEvent = db
          .prepare(
            `
          SELECT events.*, users.username as creator_name
          FROM events
          JOIN users ON events.creator_id = users.id
          WHERE events.id = ?
        `,
          )
          .get(info.lastInsertRowid)
        server.publish(
          "updates",
          JSON.stringify({ type: "new_event", data: newEvent }),
        )
        return Response.json(newEvent)
      },
    },

    "/api/bets": {
      async POST(req) {
        const { event_id, user_id, amount, bet_arrival_time, excuse } =
          await req.json()

        const user = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(user_id) as any
        if (user.username.toLowerCase() === FRIEND_NAME.toLowerCase()) {
          return Response.json(
            { error: `${FRIEND_NAME} darf nicht auf sich selbst wetten!` },
            { status: 403 },
          )
        }

        if (user.balance < amount)
          return Response.json(
            { error: "Insufficient balance" },
            { status: 400 },
          )

        const transaction = db.transaction(() => {
          db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(
            amount,
            user_id,
          )
          db.prepare(
            "INSERT INTO bets (event_id, user_id, amount, bet_arrival_time, excuse) VALUES (?, ?, ?, ?, ?)",
          ).run(event_id, user_id, amount, bet_arrival_time, excuse)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "bet_placed",
            data: { event_id, user_id, amount },
          }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/bets/:id/bonus": {
      async POST(req) {
        const { friend_id } = await req.json()
        const betId = req.params.id

        const friend = db
          .prepare("SELECT username FROM users WHERE id = ?")
          .get(friend_id) as any
        if (
          !friend ||
          friend.username.toLowerCase() !== FRIEND_NAME.toLowerCase()
        ) {
          return Response.json(
            { error: `Nur ${FRIEND_NAME} kann Ausreden-Boni vergeben!` },
            { status: 403 },
          )
        }

        const bet = db
          .prepare("SELECT * FROM bets WHERE id = ?")
          .get(betId) as any
        if (bet.bonus_given) {
          return Response.json(
            { error: "Bonus wurde bereits vergeben!" },
            { status: 400 },
          )
        }

        const event = db
          .prepare("SELECT status FROM events WHERE id = ?")
          .get(bet.event_id) as any
        if (event.status !== "closed") {
          return Response.json(
            { error: "Event muss beendet sein." },
            { status: 400 },
          )
        }

        const transaction = db.transaction(() => {
          db.prepare(
            "UPDATE bets SET payout = payout + 5, bonus_given = 1 WHERE id = ?",
          ).run(betId)
          db.prepare("UPDATE users SET balance = balance + 5 WHERE id = ?").run(
            bet.user_id,
          )
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "bonus_awarded",
            data: { bet_id: betId, user_id: bet.user_id },
          }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/events/:id/bets": async (req) => {
      const bets = db
        .prepare(
          "SELECT bets.*, users.username FROM bets JOIN users ON bets.user_id = users.id WHERE event_id = ?",
        )
        .all(req.params.id)
      return Response.json(bets)
    },

    "/api/events/:id/cancel": {
      async POST(req) {
        const { cancel_reason, user_id } = await req.json()
        const eventId = req.params.id

        const event = db
          .prepare("SELECT * FROM events WHERE id = ?")
          .get(eventId) as any
        if (!event || event.status !== "open")
          return Response.json({ error: "Invalid event" }, { status: 400 })
        if (event.creator_id !== user_id && !isAdmin(user_id))
          return Response.json({ error: "Nur der Ersteller kann stornieren." }, { status: 403 })
        if (!cancel_reason?.trim())
          return Response.json({ error: "Grund ist erforderlich." }, { status: 400 })

        const bets = db
          .prepare("SELECT * FROM bets WHERE event_id = ?")
          .all(eventId) as any[]

        const transaction = db.transaction(() => {
          bets.forEach((b) => {
            db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(b.amount, b.user_id)
            db.prepare("UPDATE bets SET payout = ? WHERE id = ?").run(b.amount, b.id)
          })
          db.prepare(
            "UPDATE events SET status = 'cancelled', cancel_reason = ? WHERE id = ?",
          ).run(cancel_reason.trim(), eventId)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({ type: "event_cancelled", data: { event_id: eventId } }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/events/:id/resolve": {
      async POST(req) {
        const { actual_arrival_time } = await req.json()
        const eventId = req.params.id

        const event = db
          .prepare("SELECT * FROM events WHERE id = ?")
          .get(eventId) as any
        if (!event || event.status !== "open")
          return Response.json({ error: "Invalid event" }, { status: 400 })

        const bets = db
          .prepare("SELECT * FROM bets WHERE event_id = ?")
          .all(eventId) as any[]
        if (bets.length === 0) {
          db.prepare(
            "UPDATE events SET status = 'closed', actual_arrival_time = ? WHERE id = ?",
          ).run(actual_arrival_time, eventId)
          return Response.json({
            success: true,
            message: "No bets to resolve",
          })
        }

        const pot = bets.reduce((sum, b) => sum + b.amount, 0)
        const actualTime = new Date(actual_arrival_time).getTime()

        const weights = bets.map((bet) => {
          const betTime = new Date(bet.bet_arrival_time).getTime()
          const diffMinutes = Math.abs(betTime - actualTime) / (1000 * 60)
          const accuracyFactor = 1 / Math.pow(diffMinutes + 1, 2)
          return {
            id: bet.id,
            user_id: bet.user_id,
            weight: bet.amount * accuracyFactor,
          }
        })

        const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)

        const transaction = db.transaction(() => {
          let distributed = 0
          const payouts = weights.map((w) => {
            const payout = Math.floor((w.weight / totalWeight) * pot)
            distributed += payout
            return { ...w, payout }
          })

          const remainder = pot - distributed
          if (remainder > 0) {
            const bestBet = payouts.reduce((prev, current) =>
              prev.weight > current.weight ? prev : current,
            )
            bestBet.payout += remainder
          }

          payouts.forEach((p) => {
            db.prepare("UPDATE bets SET payout = ? WHERE id = ?").run(
              p.payout,
              p.id,
            )
            db.prepare(
              "UPDATE users SET balance = balance + ? WHERE id = ?",
            ).run(p.payout, p.user_id)
          })
          db.prepare(
            "UPDATE events SET status = 'closed', actual_arrival_time = ? WHERE id = ?",
          ).run(actual_arrival_time, eventId)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "event_resolved",
            data: { event_id: eventId, actual_arrival_time },
          }),
        )
        return Response.json({ success: true })
      },
    },

    // ── Freie Themen-Wetten ────────────────────────────────────────────────
    // Kein FRIEND_NAME-Sonderfall: hier spielt der Namensgeber ganz normal mit.

    "/api/topics": {
      async GET() {
        const topics = db
          .prepare(
            `
          SELECT topic_events.*, users.username as creator_name
          FROM topic_events
          JOIN users ON topic_events.creator_id = users.id
          ORDER BY topic_events.id DESC
        `,
          )
          .all()
        return Response.json(topics)
      },
      async POST(req) {
        const { creator_id, description } = await req.json()

        const creator = db
          .prepare("SELECT id FROM users WHERE id = ?")
          .get(creator_id)
        if (!creator)
          return Response.json(
            { error: "Unbekannter Benutzer." },
            { status: 400 },
          )
        if (!description?.trim())
          return Response.json(
            { error: "Beschreibung ist erforderlich." },
            { status: 400 },
          )

        const info = db
          .prepare(
            "INSERT INTO topic_events (creator_id, description) VALUES (?, ?)",
          )
          .run(creator_id, description.trim())

        const newTopic = db
          .prepare(
            `
          SELECT topic_events.*, users.username as creator_name
          FROM topic_events
          JOIN users ON topic_events.creator_id = users.id
          WHERE topic_events.id = ?
        `,
          )
          .get(info.lastInsertRowid)

        server.publish(
          "updates",
          JSON.stringify({ type: "new_topic", data: newTopic }),
        )
        return Response.json(newTopic)
      },
    },

    "/api/topics/:id/bets": {
      async GET(req) {
        const bets = db
          .prepare(
            `
          SELECT topic_bets.*, users.username
          FROM topic_bets
          JOIN users ON topic_bets.user_id = users.id
          WHERE topic_event_id = ?
          ORDER BY topic_bets.id ASC
        `,
          )
          .all(req.params.id)
        return Response.json(bets)
      },
      async POST(req) {
        const { user_id, answer, amount } = await req.json()
        const topicId = req.params.id

        const topic = db
          .prepare("SELECT * FROM topic_events WHERE id = ?")
          .get(topicId) as any
        if (!topic)
          return Response.json(
            { error: "Unbekanntes Thema." },
            { status: 404 },
          )
        if (topic.status !== "open")
          return Response.json(
            { error: "Dieses Thema ist bereits abgeschlossen." },
            { status: 400 },
          )

        const user = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(user_id) as any
        if (!user)
          return Response.json(
            { error: "Unbekannter Benutzer." },
            { status: 400 },
          )

        if (!answer?.trim())
          return Response.json(
            { error: "Antwort ist erforderlich." },
            { status: 400 },
          )
        // 0 ist ausdrücklich erlaubt — man darf ohne Einsatz mitraten.
        if (!Number.isInteger(amount) || amount < 0)
          return Response.json(
            { error: "Einsatz muss eine ganze Zahl ab 0 sein." },
            { status: 400 },
          )
        if (amount > user.balance)
          return Response.json(
            { error: "Nicht genug LC." },
            { status: 400 },
          )

        const transaction = db.transaction(() => {
          db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(
            amount,
            user_id,
          )
          db.prepare(
            "INSERT INTO topic_bets (topic_event_id, user_id, answer, amount) VALUES (?, ?, ?, ?)",
          ).run(topicId, user_id, answer.trim(), amount)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "topic_bet_placed",
            data: { topic_id: topicId, user_id, amount },
          }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/topics/:id/resolve": {
      async POST(req) {
        const { user_id, resolution_text, allocations } = await req.json()
        const topicId = req.params.id

        const topic = db
          .prepare("SELECT * FROM topic_events WHERE id = ?")
          .get(topicId) as any
        if (!topic)
          return Response.json({ error: "Unbekanntes Thema." }, { status: 404 })
        if (topic.status !== "open")
          return Response.json(
            { error: "Dieses Thema ist bereits abgeschlossen." },
            { status: 400 },
          )
        if (topic.creator_id !== user_id && !isAdmin(user_id))
          return Response.json(
            { error: "Nur der Ersteller kann auflösen." },
            { status: 403 },
          )
        if (!resolution_text?.trim())
          return Response.json(
            { error: "Ergebnis-Beschreibung ist erforderlich." },
            { status: 400 },
          )

        const bets = db
          .prepare(
            "SELECT * FROM topic_bets WHERE topic_event_id = ? ORDER BY id ASC",
          )
          .all(topicId) as any[]
        const pot = bets.reduce((sum, b) => sum + b.amount, 0)

        const betsByUser = new Map<number, { id: number; amount: number }[]>()
        for (const bet of bets) {
          const list = betsByUser.get(bet.user_id) ?? []
          list.push({ id: bet.id, amount: bet.amount })
          betsByUser.set(bet.user_id, list)
        }

        const awards = new Map<number, number>()
        for (const allocation of Array.isArray(allocations) ? allocations : []) {
          const uid = allocation?.user_id
          if (!betsByUser.has(uid))
            return Response.json(
              { error: "Es kann nur an Mitspieler verteilt werden." },
              { status: 400 },
            )
          if (awards.has(uid))
            return Response.json(
              { error: "Doppelte Zuteilung für denselben Spieler." },
              { status: 400 },
            )
          if (!Number.isInteger(allocation.amount) || allocation.amount < 0)
            return Response.json(
              { error: "Zuteilungen müssen ganze Zahlen ab 0 sein." },
              { status: 400 },
            )
          awards.set(uid, allocation.amount)
        }

        const assigned = [...awards.values()].reduce((sum, a) => sum + a, 0)
        if (assigned !== pot)
          return Response.json(
            {
              error: `Es müssen genau ${pot} LC verteilt werden (aktuell ${assigned} LC).`,
            },
            { status: 400 },
          )

        const transaction = db.transaction(() => {
          for (const [uid, userBets] of betsByUser) {
            const award = awards.get(uid) ?? 0
            // Zugeteilt wird pro Spieler, gespeichert pro Wette.
            for (const [betId, payout] of splitAcrossBets(userBets, award)) {
              db.prepare("UPDATE topic_bets SET payout = ? WHERE id = ?").run(
                payout,
                betId,
              )
            }
            if (award > 0)
              db.prepare(
                "UPDATE users SET balance = balance + ? WHERE id = ?",
              ).run(award, uid)
          }
          db.prepare(
            "UPDATE topic_events SET status = 'resolved', resolution_text = ? WHERE id = ?",
          ).run(resolution_text.trim(), topicId)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "topic_resolved",
            data: { topic_id: topicId },
          }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/topics/:id/refund": {
      async POST(req) {
        const { user_id, refund_reason } = await req.json()
        const topicId = req.params.id

        const topic = db
          .prepare("SELECT * FROM topic_events WHERE id = ?")
          .get(topicId) as any
        if (!topic)
          return Response.json({ error: "Unbekanntes Thema." }, { status: 404 })
        if (topic.status !== "open")
          return Response.json(
            { error: "Dieses Thema ist bereits abgeschlossen." },
            { status: 400 },
          )
        if (topic.creator_id !== user_id && !isAdmin(user_id))
          return Response.json(
            { error: "Nur der Ersteller kann schließen." },
            { status: 403 },
          )
        if (!refund_reason?.trim())
          return Response.json(
            { error: "Grund ist erforderlich." },
            { status: 400 },
          )

        const bets = db
          .prepare("SELECT * FROM topic_bets WHERE topic_event_id = ?")
          .all(topicId) as any[]

        const transaction = db.transaction(() => {
          bets.forEach((bet) => {
            db.prepare(
              "UPDATE users SET balance = balance + ? WHERE id = ?",
            ).run(bet.amount, bet.user_id)
            db.prepare("UPDATE topic_bets SET payout = ? WHERE id = ?").run(
              bet.amount,
              bet.id,
            )
          })
          db.prepare(
            "UPDATE topic_events SET status = 'refunded', refund_reason = ? WHERE id = ?",
          ).run(refund_reason.trim(), topicId)
        })
        transaction()

        server.publish(
          "updates",
          JSON.stringify({
            type: "topic_refunded",
            data: { topic_id: topicId },
          }),
        )
        return Response.json({ success: true })
      },
    },

    // ── Admin ──────────────────────────────────────────────────────────────
    // Nur erreichbar, wenn FRIEND_BET_ADMIN gesetzt ist und die mitgeschickte
    // user_id genau diesem Namen gehört.

    "/api/admin/users/:id/balance": {
      async POST(req) {
        const { admin_id, balance } = await req.json()
        if (!isAdmin(admin_id))
          return Response.json({ error: "Keine Admin-Rechte." }, { status: 403 })

        if (!Number.isInteger(balance) || balance < 0)
          return Response.json(
            { error: "Kontostand muss eine ganze Zahl ab 0 sein." },
            { status: 400 },
          )

        const target = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(req.params.id) as any
        if (!target)
          return Response.json(
            { error: "Unbekannter Benutzer." },
            { status: 404 },
          )

        db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(
          balance,
          req.params.id,
        )

        server.publish(
          "updates",
          JSON.stringify({
            type: "admin_update",
            data: { user_id: target.id },
          }),
        )
        return Response.json({ success: true })
      },
    },

    "/api/admin/users/:id/delete": {
      async POST(req) {
        const { admin_id, confirm_username } = await req.json()
        if (!isAdmin(admin_id))
          return Response.json({ error: "Keine Admin-Rechte." }, { status: 403 })

        const target = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(req.params.id) as any
        if (!target)
          return Response.json(
            { error: "Unbekannter Benutzer." },
            { status: 404 },
          )

        if (target.id === admin_id)
          return Response.json(
            { error: "Du kannst dich nicht selbst löschen." },
            { status: 400 },
          )

        if (
          confirm_username?.trim().toLowerCase() !==
          target.username.toLowerCase()
        )
          return Response.json(
            { error: "Benutzername stimmt nicht überein." },
            { status: 400 },
          )

        // Nur ungenutzte Konten: sobald jemand gewettet oder ein Event
        // erstellt hat, hängt fremde Historie daran. Die bliebe beim Löschen
        // als Leiche zurück, also lieber gar nicht erst anfangen.
        const usage = db
          .prepare(
            `
          SELECT
            (SELECT COUNT(*) FROM bets WHERE user_id = ?1)
            + (SELECT COUNT(*) FROM topic_bets WHERE user_id = ?1) as bets,
            (SELECT COUNT(*) FROM events WHERE creator_id = ?1)
            + (SELECT COUNT(*) FROM topic_events WHERE creator_id = ?1) as events
        `,
          )
          .get(target.id) as any

        if (usage.bets > 0 || usage.events > 0)
          return Response.json(
            {
              error: `${target.username} hat bereits mitgespielt (${usage.bets} Wetten, ${usage.events} Events) und kann nicht gelöscht werden.`,
            },
            { status: 400 },
          )

        db.prepare("DELETE FROM users WHERE id = ?").run(target.id)

        server.publish(
          "updates",
          JSON.stringify({
            type: "admin_update",
            data: { user_id: target.id },
          }),
        )
        return Response.json({ success: true })
      },
    },
  },

  websocket: {
    open(ws) {
      ws.subscribe("updates")
    },
    message(ws, message) {},
    close(ws) {
      ws.unsubscribe("updates")
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
})

console.log(`🚀 ${FRIEND_NAME}-Bet Server running at ${server.url}`)
if (ADMIN_NAME) console.log(`🔑 Admin: ${ADMIN_NAME}`)
