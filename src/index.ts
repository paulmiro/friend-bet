import { serve } from "bun"
import { db } from "./db"
import indexHtml from "./index.html"

const FRIEND_NAME = process.env.FRIEND_BET_NAME
if (!FRIEND_NAME) {
  console.error("❌ FRIEND_BET_NAME environment variable is required.")
  process.exit(1)
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

    "/rss.xml": (req) => {
      const origin = new URL(req.url).origin
      const events = db
        .prepare(
          `SELECT events.*, users.username as creator_name
           FROM events JOIN users ON events.creator_id = users.id
           ORDER BY events.id DESC LIMIT 50`,
        )
        .all() as any[]

      // ponytail: hand-rolled RSS 2.0, no feed lib. Add one if we need Atom/enclosures.
      const esc = (s: string) =>
        String(s).replace(/[<>&'"]/g, (c) =>
          ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
        )

      const items = events
        .map((e) => {
          // stored as unix epoch; RSS pubDate must be RFC-822
          const pubDate = e.created_at
            ? `\n      <pubDate>${new Date(e.created_at * 1000).toUTCString()}</pubDate>`
            : ""
          return `    <item>
      <title>${esc(`${FRIEND_NAME}-Bet: ${e.description}`)}</title>
      <link>${origin}/</link>
      <guid isPermaLink="false">event-${e.id}</guid>
      <description>${esc(`Neue Wette von ${e.creator_name}, geplant für ${e.scheduled_time}.`)}</description>${pubDate}
    </item>`
        })
        .join("\n")

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(`${FRIEND_NAME}-Bet`)}</title>
    <link>${origin}/</link>
    <description>${esc(`Neue Wetten für ${FRIEND_NAME}-Bet`)}</description>
${items}
  </channel>
</rss>`
      return new Response(xml, {
        headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
      })
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

      const history = db
        .prepare(
          `
        SELECT
          b.*,
          e.description as event_description,
          e.actual_arrival_time,
          e.scheduled_time,
          e.status as event_status
        FROM bets b
        JOIN events e ON b.event_id = e.id
        WHERE b.user_id = ?
        ORDER BY b.id DESC
      `,
        )
        .all(userId)

      return Response.json({ stats, history })
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
        const info = db
          .prepare(
            "INSERT INTO events (creator_id, description, scheduled_time, created_at) VALUES (?, ?, ?, unixepoch())",
          )
          .run(creator_id, description, scheduled_time)

        const newEvent = {
          id: info.lastInsertRowid,
          creator_id,
          description,
          scheduled_time,
          status: "open",
        }
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
        if (event.creator_id !== user_id)
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
