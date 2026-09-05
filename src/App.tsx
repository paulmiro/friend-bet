import React, { useState, useEffect, useRef } from "react"
import {
  Clock,
  Plus,
  Wallet,
  LogOut,
  CheckCircle2,
  User as UserIcon,
  Trophy,
  Home,
  Lock,
  LockOpen,
  MessageSquare,
  RotateCcw,
  Undo2,
} from "lucide-react"
import { redistribute } from "./payout"

interface User {
  id: number
  username: string
  balance: number
}

interface Event {
  id: number
  creator_id: number
  creator_name?: string
  description: string
  scheduled_time: string
  actual_arrival_time: string | null
  status: "open" | "closed" | "cancelled"
  cancel_reason?: string | null
  created_at?: string | null
}

/** Freie Wette auf irgendein Thema — der Ersteller verteilt den Pot von Hand. */
interface TopicEvent {
  id: number
  creator_id: number
  creator_name?: string
  description: string
  status: "open" | "resolved" | "refunded"
  resolution_text: string | null
  refund_reason: string | null
  created_at: string
}

interface TopicBet {
  id: number
  topic_event_id: number
  user_id: number
  username: string
  answer: string
  amount: number
  payout: number
}

interface Bet {
  id: number
  event_id: number
  user_id: number
  username: string
  amount: number
  bet_arrival_time: string
  excuse: string
  payout: number
  bonus_given: number
}

const friendName = process.env.FRIEND_BET_NAME as string // replaced by bun at build time

const parseLocalDatetime = (value: string): Date => {
  const [datePart, timePart] = value.split("T")
  if (!datePart || !timePart) {
    throw new Error(
      `Invalid datetime format: "${value}". Expected YYYY-MM-DDTHH:mm`,
    )
  }
  const [year, month, day] = datePart.split("-").map(Number)
  const [hours, minutes] = timePart.split(":").map(Number)
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hours === undefined ||
    minutes === undefined
  ) {
    throw new Error(`Invalid datetime components in value: "${value}"`)
  }
  return new Date(year, month - 1, day, hours, minutes)
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [topics, setTopics] = useState<TopicEvent[]>([])
  const [view, setView] = useState<
    "dashboard" | "create" | "account" | "transparency" | "leaderboard"
  >("dashboard")
  const [username, setUsername] = useState("")
  const [createType, setCreateType] = useState<"punctuality" | "topic">(
    "punctuality",
  )
  const [notification, setNotification] = useState<string | null>(null)
  // Zähler statt Prop-Vergleich: sagt den Karten, dass sie ihre Wetten neu
  // laden sollen, auch wenn sich das Event selbst nicht verändert hat.
  const [refreshTick, setRefreshTick] = useState(0)
  const ws = useRef<WebSocket | null>(null)

  useEffect(() => {
    document.title = `${friendName}-Bet 🎯`
    const savedUser = localStorage.getItem("friend_bet_user")
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser)
      setUser(parsedUser)
      refreshUser(parsedUser.id)
    }
    fetchEvents()
    fetchTopics()

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    ws.current = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.current.onmessage = (message) => {
      const { type, data } = JSON.parse(message.data)
      if (type === "new_event") {
        setEvents((prev) => [data, ...prev])
        showNotification(`New Event: ${data.description}`)
      } else if (type === "new_topic") {
        setTopics((prev) => [data, ...prev])
        showNotification(`Neue Wette: ${data.description}`)
      } else if (
        type === "event_resolved" ||
        type === "event_cancelled" ||
        type === "bonus_awarded" ||
        type === "bet_placed"
      ) {
        fetchEvents()
        if (user) refreshUser(user.id)
      } else if (
        type === "topic_resolved" ||
        type === "topic_refunded" ||
        type === "topic_bet_placed"
      ) {
        fetchTopics()
        setRefreshTick((tick) => tick + 1)
        if (user) refreshUser(user.id)
      }
    }

    return () => {
      ws.current?.close()
    }
  }, [])

  const showNotification = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 5000)
  }

  const refreshUser = async (id: number) => {
    try {
      const res = await fetch(`/api/me/${id}`)
      const data = await res.json()
      setUser(data)
      localStorage.setItem("friend_bet_user", JSON.stringify(data))
    } catch (err) {
      console.error(err)
    }
  }

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/events")
      const data = await res.json()
      setEvents(data)
    } catch (err) {
      console.error(err)
    }
  }

  const fetchTopics = async () => {
    try {
      const res = await fetch("/api/topics")
      const data = await res.json()
      setTopics(data)
    } catch (err) {
      console.error(err)
    }
  }

  const refreshAll = () => {
    fetchEvents()
    fetchTopics()
    setRefreshTick((tick) => tick + 1)
    if (user) refreshUser(user.id)
  }

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Login failed")
      setUser(data)
      localStorage.setItem("friend_bet_user", JSON.stringify(data))
    } catch (err: any) {
      alert(err.message)
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("friend_bet_user")
  }

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      if (createType === "topic") {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creator_id: user?.id,
            description: form.description.value,
          }),
        })
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to create topic")
        fetchTopics()
        setView("dashboard")
        return
      }

      const scheduledTimeLocal = form.scheduled_time.value
      const scheduledTimeUTC =
        parseLocalDatetime(scheduledTimeLocal).toISOString()
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator_id: user?.id,
          description: form.description.value,
          scheduled_time: scheduledTimeUTC,
        }),
      })
      if (!res.ok) throw new Error("Failed to create event")
      setView("dashboard")
    } catch (err: any) {
      alert(err.message)
    }
  }

  // Ein gemeinsamer Feed: beide Sorten nach Alter, offene zuerst.
  const feed = [
    ...events.map((event) => ({
      key: `event-${event.id}`,
      sort: event.created_at ?? event.scheduled_time ?? "",
      open: event.status === "open",
      node: (
        <EventCard
          event={event}
          currentUser={user!}
          friendName={friendName}
          onUpdate={refreshAll}
        />
      ),
    })),
    ...topics.map((topic) => ({
      key: `topic-${topic.id}`,
      sort: topic.created_at ?? "",
      open: topic.status === "open",
      node: (
        <TopicCard
          topic={topic}
          currentUser={user!}
          refreshTick={refreshTick}
          onUpdate={refreshAll}
        />
      ),
    })),
  ].sort(
    (a, b) => Number(b.open) - Number(a.open) || (a.sort < b.sort ? 1 : -1),
  )

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700">
          <h1 className="text-4xl font-black text-white text-center mb-2">
            {friendName}-Bet 🎯
          </h1>
          <p className="text-slate-400 text-center mb-8">
            Wette auf die Pünktlichkeit deiner Freunde
          </p>
          <form onSubmit={login} className="space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              required
            />
            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all active:scale-95"
            >
              Einsteigen
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {notification && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-xl shadow-2xl z-50 animate-bounce">
          {notification}
        </div>
      )}

      <nav className="sticky top-0 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-40">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <h1
            onClick={() => setView("dashboard")}
            className="text-xl sm:text-2xl font-black text-white cursor-pointer hover:text-blue-400 transition-colors"
          >
            {friendName}-Bet
          </h1>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setView("dashboard")}
              className={`text-sm font-bold transition-all flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-xl border ${
                view === "dashboard"
                  ? "bg-blue-600/15 border-blue-500/30 text-blue-400"
                  : "bg-slate-800/40 border-slate-750/30 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
              }`}
              title="Dashboard"
            >
              <Home size={18} />
              <span className="hidden sm:inline">Home</span>
            </button>
            <button
              onClick={() => setView("leaderboard")}
              className={`text-sm font-bold transition-all flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-xl border ${
                view === "leaderboard"
                  ? "bg-blue-600/15 border-blue-500/30 text-blue-400"
                  : "bg-slate-800/40 border-slate-750/30 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
              }`}
              title="Leaderboard"
            >
              <Trophy size={18} className="text-yellow-500" />
              <span className="hidden sm:inline">Leaderboard</span>
            </button>
            <button
              onClick={() => setView("account")}
              className={`text-sm font-bold transition-all flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5  rounded-xl border ${
                view === "account"
                  ? "bg-blue-600/15 border-blue-500/30 text-blue-400"
                  : "bg-slate-800/40 border-slate-750/30 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
              }`}
              title="Konto"
            >
              <Wallet size={18} className="text-green-500" />
              <span className="font-bold text-green-500 text-sm sm:text-base">
                {user.balance} LC
              </span>
            </button>
            <button
              onClick={logout}
              className="h-9 w-9 sm:h-10 sm:w-10 bg-slate-800/40 hover:bg-red-950/20 border border-slate-700/30 hover:border-red-900/30 rounded-xl text-slate-400 hover:text-red-400 transition-all flex items-center justify-center"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {view === "dashboard" && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-3xl font-bold text-white">Events</h2>
              <button
                onClick={() => setView("create")}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 active:scale-95"
              >
                <Plus size={20} /> Neues Event
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {feed.map((entry) => (
                <React.Fragment key={entry.key}>{entry.node}</React.Fragment>
              ))}
              {feed.length === 0 && (
                <div className="col-span-full py-20 text-center bg-slate-900 rounded-3xl border-2 border-dashed border-slate-800">
                  <p className="text-slate-500 text-lg">
                    Keine aktiven Events. Starte eines!
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {view === "create" && (
          <div className="max-w-2xl mx-auto bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl">
            <h2 className="text-3xl font-bold text-white mb-6">
              Neues Event starten
            </h2>
            <form onSubmit={createEvent} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">
                  Art der Wette
                </label>
                <div className="flex bg-slate-950 rounded-xl border border-slate-700 overflow-hidden p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setCreateType("punctuality")}
                    className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                      createType === "punctuality"
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Clock size={16} /> Pünktlichkeit
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateType("topic")}
                    className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                      createType === "topic"
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <MessageSquare size={16} /> Freies Thema
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  {createType === "punctuality"
                    ? `Getippt wird die Ankunftszeit. Der Pot wird automatisch nach Genauigkeit verteilt.`
                    : "Getippt wird mit freiem Text. Du verteilst den Pot am Ende selbst."}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-400">
                  Beschreibung
                </label>
                <input
                  name="description"
                  placeholder={
                    createType === "punctuality"
                      ? `z.B. ${friendName} kommt zur Mensa`
                      : "z.B. Wer gewinnt heute Abend?"
                  }
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  required
                />
              </div>
              {createType === "punctuality" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">
                    Geplante Ankunft
                  </label>
                  <input
                    name="scheduled_time"
                    type="datetime-local"
                    className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>
              )}
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setView("dashboard")}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all"
                >
                  Event erstellen
                </button>
              </div>
            </form>
          </div>
        )}

        {view === "account" && <AccountOverview userId={user.id} />}
        {view === "transparency" && (
          <TransparencyPage
            friendName={friendName}
            onBack={() => setView("dashboard")}
          />
        )}
        {view === "leaderboard" && <LeaderboardPage currentUser={user} />}
      </main>

      <footer className="border-t border-slate-900 mt-20 bg-slate-950 py-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-sm">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setView("transparency")}
              className="hover:text-blue-400 transition-colors"
            >
              Transparenz & Formeln
            </button>
            <button
              onClick={() => setView("leaderboard")}
              className="hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              <Trophy size={14} /> Leaderboard
            </button>
          </div>
          <span>© 2026 {friendName}-Bet</span>
        </div>
      </footer>
    </div>
  )
}

function TransparencyPage({
  friendName,
  onBack,
}: {
  friendName: string
  onBack: () => void
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <div className="space-y-4">
        <h2 className="text-4xl font-black text-white">
          Transparenz & Payout-Logik
        </h2>
        <p className="text-slate-400 text-lg">
          {friendName}-Bet nutzt ein proportionales Payout-System. Es gibt
          keinen "Winner-takes-all", sondern der gesamte Pot wird basierend auf
          der Genauigkeit und dem Einsatz aller Teilnehmer verteilt.
        </p>
      </div>

      <section className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-lg space-y-6">
        <h3 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm">
            ∑
          </div>
          Die Formel
        </h3>
        <div className="bg-slate-950 p-6 rounded-2xl border border-blue-900/30 text-blue-400 font-mono text-center text-lg">
          Gewicht = Einsatz × (1 / (Abweichung_in_Minuten + 1)²)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
            <strong className="text-white block mb-1">Einsatz</strong>
            Wer mehr setzt, bekommt einen größeren Anteil am Pot.
          </div>
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
            <strong className="text-white block mb-1">
              Quadratische Abweichung
            </strong>
            Die Genauigkeit wird massiv belohnt. Eine Abweichung von 2 Minuten
            ist 4-mal schwerwiegender als eine Abweichung von 1 Minute.
          </div>
        </div>
      </section>

      <section className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-lg space-y-6">
        <h3 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
            <MessageSquare size={16} />
          </div>
          Freie Wetten
        </h3>
        <p className="text-slate-400">
          Neben Pünktlichkeits-Events gibt es <strong>freie Wetten</strong> auf
          beliebige Themen. Hier zählt keine Formel: getippt wird mit freiem
          Text, jeder darf beliebig oft mitwetten (auch mit 0 LC), und am Ende
          verteilt der Ersteller den Pot von Hand — mit einer kurzen
          Beschreibung, was tatsächlich passiert ist.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
            <strong className="text-white block mb-1">
              Der Pot bleibt erhalten
            </strong>
            Es kann nur genau so viel verteilt werden, wie eingesetzt wurde —
            keine LC entstehen oder verschwinden.
          </div>
          <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700">
            <strong className="text-white block mb-1">
              Schließen statt auflösen
            </strong>
            Lässt sich nichts entscheiden, schließt der Ersteller die Wette mit
            einem Grund — dann bekommt jeder seinen Einsatz zurück.
          </div>
        </div>
        <p className="text-slate-400">
          Bei freien Wetten darf auch {friendName} selbst mitspielen — die
          Sperre gilt nur für Wetten auf seine eigene Pünktlichkeit.
        </p>
      </section>

      <section className="space-y-6">
        <h3 className="text-2xl font-bold text-white">Ausreden-Bonus</h3>
        <p className="text-slate-400">
          Bei jeder Wette muss eine vermutete Ausrede angegeben werden. Sobald
          ein Event beendet ist, kann {friendName} persönlich Belohnungen
          verteilen. Für jede Ausrede, die ihm besonders gut gefällt (oder die
          der Wahrheit entspricht), kann er einen{" "}
          <strong>Bonus von +5 LC</strong> vergeben. Dieser Bonus kommt direkt
          aus der "Bank" und beeinflusst nicht den restlichen Pot.
        </p>
      </section>

      <div className="pt-8">
        <button
          onClick={onBack}
          className="bg-slate-800 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all"
        >
          Zurück
        </button>
      </div>
    </div>
  )
}

function AccountOverview({ userId }: { userId: number }) {
  const [data, setData] = useState<{ stats: any; history: any[] } | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/stats/${userId}`)
        const data = await res.json()
        setData(data)
      } catch (err) {
        console.error(err)
      }
    }
    fetchStats()
  }, [userId])

  if (!data)
    return <div className="text-center py-20 text-slate-500">Laden...</div>

  const profit =
    (data.stats.total_payout || 0) - (data.stats.total_wagered || 0)

  return (
    <div className="space-y-12">
      <h2 className="text-3xl font-bold text-white">Account Übersicht</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Wetten",
            value: data.stats.total_bets,
            color: "text-blue-400",
          },
          {
            label: "Eingesetzt",
            value: `${data.stats.total_wagered || 0} LC`,
            color: "text-slate-400",
          },
          {
            label: "Gewonnen",
            value: `${data.stats.total_payout || 0} LC`,
            color: "text-green-400",
          },
          {
            label: "Profit",
            value: `${profit > 0 ? "+" : ""}${profit} LC`,
            color: profit >= 0 ? "text-green-400" : "text-red-400",
          },
        ].map((stat, i) => (
          <div
            key={i}
            className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-lg"
          >
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {stat.label}
            </label>
            <div className={`text-2xl font-black mt-1 ${stat.color}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <h3 className="text-2xl font-bold text-white">Wett-Historie</h3>
        <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden">
          {data.history.length === 0 ? (
            <p className="p-12 text-center text-slate-500">
              Noch keine Wetten abgeschlossen.
            </p>
          ) : (
            <div className="divide-y divide-slate-800">
              {data.history.map((bet) => (
                <div
                  key={bet.id}
                  className="p-6 flex items-center justify-between hover:bg-slate-800/50 transition-colors"
                >
                  <div className="space-y-1 min-w-0 pr-4">
                    <span className="text-white font-bold block">
                      {bet.event_description}
                    </span>
                    <span className="text-slate-500 text-sm">
                      {bet.kind === "topic"
                        ? `Antwort: "${bet.answer}"`
                        : `Tipp: ${new Date(
                            bet.bet_arrival_time,
                          ).toLocaleTimeString("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}`}
                    </span>
                  </div>
                  <div className="text-right space-y-1 shrink-0">
                    <span className="text-slate-400 font-medium block">
                      -{bet.amount} LC
                    </span>
                    {bet.event_status === "cancelled" ||
                    bet.event_status === "refunded" ? (
                      <span className="text-red-400 text-sm font-bold bg-red-500/10 px-2 py-0.5 rounded">
                        Erstattet
                      </span>
                    ) : bet.actual_arrival_time ||
                      bet.event_status === "resolved" ? (
                      <span
                        className={`font-bold ${bet.payout > 0 ? "text-green-400" : "text-slate-600"}`}
                      >
                        {bet.payout > 0 ? `+${bet.payout}` : "0"} LC
                      </span>
                    ) : (
                      <span className="text-blue-500 text-sm font-bold bg-blue-500/10 px-2 py-0.5 rounded">
                        Offen
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventCard({
  event,
  currentUser,
  friendName,
  onUpdate,
}: {
  event: Event
  currentUser: User
  friendName: string
  onUpdate: () => void
}) {
  const [bets, setBets] = useState<Bet[]>([])
  const [showBetForm, setShowBetForm] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [betDirection, setBetDirection] = useState<"plus" | "minus">("plus")

  useEffect(() => {
    fetchBets()
  }, [event.id])

  const fetchBets = async () => {
    try {
      const res = await fetch(`/api/events/${event.id}/bets`)
      const data = await res.json()
      setBets(data)
    } catch (err) {
      console.error(err)
    }
  }

  const placeBet = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      const minutes = parseInt(form.minutes.value)
      const scheduledDate = new Date(event.scheduled_time)
      const offset = betDirection === "plus" ? minutes : -minutes
      const betDate = new Date(scheduledDate.getTime() + offset * 60000)

      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          user_id: currentUser.id,
          amount: parseInt(form.amount.value),
          bet_arrival_time: betDate.toISOString(),
          excuse: form.excuse.value,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Bet failed")

      setShowBetForm(false)
      fetchBets()
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const resolveEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      const actualTimeLocal = form.actual_time.value
      const actualTimeUTC = parseLocalDatetime(actualTimeLocal).toISOString()
      const res = await fetch(`/api/events/${event.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_arrival_time: actualTimeUTC }),
      })
      if (!res.ok) throw new Error("Resolve failed")
      setIsResolving(false)
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const cancelEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      const res = await fetch(`/api/events/${event.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancel_reason: form.cancel_reason.value,
          user_id: currentUser.id,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Cancel failed")
      setIsCancelling(false)
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const awardBonus = async (betId: number) => {
    try {
      const res = await fetch(`/api/bets/${betId}/bonus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friend_id: currentUser.id }),
      })
      if (!res.ok) throw new Error("Bonus failed")
      fetchBets()
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const isTargetFriend =
    currentUser.username.toLowerCase() === friendName.toLowerCase()

  return (
    <div
      className={`group relative bg-slate-900 rounded-3xl border shadow-xl overflow-hidden transition-all ${event.status === "cancelled" ? "border-red-900/50 opacity-75" : "border-slate-800 hover:border-slate-700"} ${event.status !== "open" ? "opacity-75" : ""}`}
    >
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">
              {event.description}
            </h3>
            {event.creator_name && (
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Von {event.creator_name}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span
              className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${event.status === "open" ? "bg-green-500/10 text-green-500" : event.status === "cancelled" ? "bg-red-500/10 text-red-400" : "bg-slate-800 text-slate-500"}`}
            >
              {event.status === "open"
                ? "Aktiv"
                : event.status === "cancelled"
                  ? "Storniert"
                  : "Beendet"}
            </span>
            <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter bg-blue-500/10 text-blue-400">
              <Clock size={10} /> Pünktlich
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center gap-3 text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
            <Clock size={16} className="text-blue-500" />
            <span className="text-sm">
              Soll: {new Date(event.scheduled_time).toLocaleString("de-DE")}
            </span>
          </div>
          {event.actual_arrival_time && (
            <div className="flex items-center gap-3 text-green-400 bg-green-500/5 p-3 rounded-xl border border-green-500/20">
              <CheckCircle2 size={16} />
              <span className="text-sm font-bold">
                Ist:{" "}
                {new Date(event.actual_arrival_time).toLocaleString("de-DE")}
              </span>
            </div>
          )}
          {event.status === "cancelled" && event.cancel_reason && (
            <div className="flex items-start gap-3 text-red-400 bg-red-500/5 p-3 rounded-xl border border-red-500/20">
              <span className="text-sm font-bold">
                Grund: {event.cancel_reason}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest">
              Wetten ({bets.length})
            </h4>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {bets.map((bet) => (
              <div
                key={bet.id}
                className="bg-slate-950/50 rounded-2xl border border-slate-800/50 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">
                      {bet.username}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(bet.bet_arrival_time).toLocaleTimeString(
                        "de-DE",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-black text-blue-400 text-sm">
                      {bet.amount} LC
                    </span>
                    {event.status === "closed" && (
                      <span
                        className={`text-sm font-black ${bet.payout - (bet.bonus_given ? 5 : 0) - bet.amount > 0 ? "text-green-400" : bet.payout - (bet.bonus_given ? 5 : 0) - bet.amount < 0 ? "text-red-400" : "text-slate-500"}`}
                      >
                        {bet.payout - (bet.bonus_given ? 5 : 0) - bet.amount > 0
                          ? "+"
                          : ""}
                        {bet.payout - (bet.bonus_given ? 5 : 0) - bet.amount}
                      </span>
                    )}
                  </div>
                </div>
                {bet.excuse && (
                  <div className="pt-2 border-t border-slate-800 flex items-start justify-between gap-4">
                    <p className="text-xs text-slate-400 italic">
                      " {bet.excuse} "
                    </p>
                    {bet.bonus_given === 1 && (
                      <span className="bg-yellow-500/10 text-yellow-500 text-[10px] px-1.5 py-0.5 rounded font-black">
                        +5 LC
                      </span>
                    )}
                  </div>
                )}
                {event.status === "closed" &&
                  isTargetFriend &&
                  bet.bonus_given !== 1 && (
                    <button
                      onClick={() => awardBonus(bet.id)}
                      className="w-full mt-2 py-1.5 bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-500 text-xs font-bold rounded-lg transition-all border border-yellow-600/20"
                    >
                      Bonus geben
                    </button>
                  )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 bg-slate-800/30 border-t border-slate-800">
        {event.status === "open" ? (
          <div className="space-y-4">
            {!showBetForm && !isResolving && !isCancelling && (
              <div className="flex gap-3">
                {!isTargetFriend && (
                  <button
                    onClick={() => setShowBetForm(true)}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
                  >
                    Wetten
                  </button>
                )}
                {currentUser.id === event.creator_id && (
                  <button
                    onClick={() => setIsResolving(true)}
                    className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all active:scale-95"
                  >
                    Beenden
                  </button>
                )}
                {currentUser.id === event.creator_id && (
                  <button
                    onClick={() => setIsCancelling(true)}
                    className="py-3 px-4 bg-red-900/30 hover:bg-red-900/50 text-red-400 font-bold rounded-xl transition-all active:scale-95 border border-red-900/50"
                  >
                    Stornieren
                  </button>
                )}
              </div>
            )}

            {showBetForm && (
              <form
                onSubmit={placeBet}
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="grid grid-cols-2 gap-3">
                  <input
                    name="amount"
                    type="number"
                    placeholder="Einsatz (LC)"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                    required
                    min="1"
                  />
                  <div className="flex bg-slate-950 rounded-lg border border-slate-700 overflow-hidden">
                    <button
                      type="button"
                      className={`flex-1 px-2 font-black transition-colors ${betDirection === "plus" ? "bg-blue-600 text-white" : "text-slate-500"}`}
                      onClick={() => setBetDirection("plus")}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={`flex-1 px-2 font-black transition-colors ${betDirection === "minus" ? "bg-blue-600 text-white" : "text-slate-500"}`}
                      onClick={() => setBetDirection("minus")}
                    >
                      -
                    </button>
                    <input
                      name="minutes"
                      type="number"
                      placeholder="Min"
                      className="w-16 px-2 py-2 bg-transparent text-sm text-white focus:outline-none"
                      required
                      min="0"
                    />
                  </div>
                </div>
                <input
                  name="excuse"
                  type="text"
                  placeholder={`${friendName}s Ausrede...`}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                  required
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all"
                  >
                    Go
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBetForm(false)}
                    className="flex-1 py-2 bg-slate-800 text-slate-400 font-bold rounded-lg transition-all"
                  >
                    Stop
                  </button>
                </div>
              </form>
            )}

            {isResolving && (
              <form
                onSubmit={resolveEvent}
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Tatsächliche Ankunft:
                  </label>
                  <input
                    name="actual_time"
                    type="datetime-local"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-all"
                  >
                    Bestätigen
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsResolving(false)}
                    className="flex-1 py-2 bg-slate-800 text-slate-400 font-bold rounded-lg transition-all"
                  >
                    Abbruch
                  </button>
                </div>
              </form>
            )}

            {isCancelling && (
              <form
                onSubmit={cancelEvent}
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                    Grund für Stornierung:
                  </label>
                  <input
                    name="cancel_reason"
                    type="text"
                    placeholder="z.B. ist nicht erschienen"
                    className="w-full px-3 py-2 bg-slate-950 border border-red-900/50 rounded-lg text-sm text-white"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg transition-all"
                  >
                    Wetten stornieren & erstatten
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCancelling(false)}
                    className="flex-1 py-2 bg-slate-800 text-slate-400 font-bold rounded-lg transition-all"
                  >
                    Abbruch
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="text-center py-2">
            <span
              className={`text-sm font-bold ${event.status === "cancelled" ? "text-red-500" : "text-slate-500"}`}
            >
              {event.status === "cancelled"
                ? "Event Storniert — Einsätze erstattet"
                : "Event Abgeschlossen"}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function TopicCard({
  topic,
  currentUser,
  refreshTick,
  onUpdate,
}: {
  topic: TopicEvent
  currentUser: User
  refreshTick: number
  onUpdate: () => void
}) {
  const [bets, setBets] = useState<TopicBet[]>([])
  const [showBetForm, setShowBetForm] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [isRefunding, setIsRefunding] = useState(false)

  useEffect(() => {
    fetchBets()
  }, [topic.id, topic.status, refreshTick])

  const fetchBets = async () => {
    try {
      const res = await fetch(`/api/topics/${topic.id}/bets`)
      setBets(await res.json())
    } catch (err) {
      console.error(err)
    }
  }

  const placeBet = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      const res = await fetch(`/api/topics/${topic.id}/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          answer: form.answer.value,
          amount: parseInt(form.amount.value, 10),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Bet failed")
      setShowBetForm(false)
      fetchBets()
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const refundTopic = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as any
    try {
      const res = await fetch(`/api/topics/${topic.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          refund_reason: form.refund_reason.value,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Refund failed")
      setIsRefunding(false)
      onUpdate()
    } catch (err: any) {
      alert(err.message)
    }
  }

  const isCreator = currentUser.id === topic.creator_id
  const pot = bets.reduce((sum, bet) => sum + bet.amount, 0)
  const hasBet = bets.some((bet) => bet.user_id === currentUser.id)

  return (
    <div
      className={`group relative bg-slate-900 rounded-3xl border shadow-xl overflow-hidden transition-all ${topic.status === "refunded" ? "border-red-900/50 opacity-75" : "border-slate-800 hover:border-slate-700"} ${topic.status !== "open" ? "opacity-75" : ""}`}
    >
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-start gap-3">
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">
              {topic.description}
            </h3>
            {topic.creator_name && (
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Von {topic.creator_name}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span
              className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${topic.status === "open" ? "bg-green-500/10 text-green-500" : topic.status === "refunded" ? "bg-red-500/10 text-red-400" : "bg-slate-800 text-slate-500"}`}
            >
              {topic.status === "open"
                ? "Aktiv"
                : topic.status === "refunded"
                  ? "Erstattet"
                  : "Aufgelöst"}
            </span>
            <span className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter bg-purple-500/10 text-purple-400">
              <MessageSquare size={10} /> Frei
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center gap-3 text-slate-400 bg-slate-950/50 p-3 rounded-xl border border-slate-800">
            <Wallet size={16} className="text-blue-500" />
            <span className="text-sm">
              Pot: <strong className="text-white">{pot} LC</strong>
            </span>
          </div>
          {topic.status === "resolved" && topic.resolution_text && (
            <div className="flex items-start gap-3 text-green-400 bg-green-500/5 p-3 rounded-xl border border-green-500/20">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span className="text-sm font-bold">{topic.resolution_text}</span>
            </div>
          )}
          {topic.status === "refunded" && topic.refund_reason && (
            <div className="flex items-start gap-3 text-red-400 bg-red-500/5 p-3 rounded-xl border border-red-500/20">
              <span className="text-sm font-bold">
                Grund: {topic.refund_reason}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest">
            Wetten ({bets.length})
          </h4>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {bets.map((bet) => (
              <div
                key={bet.id}
                className="bg-slate-950/50 rounded-2xl border border-slate-800/50 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-white text-sm truncate">
                    {bet.username}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-black text-blue-400 text-sm">
                      {bet.amount} LC
                    </span>
                    {topic.status === "resolved" && (
                      <span
                        className={`text-sm font-black ${bet.payout - bet.amount > 0 ? "text-green-400" : bet.payout - bet.amount < 0 ? "text-red-400" : "text-slate-500"}`}
                      >
                        {bet.payout - bet.amount > 0 ? "+" : ""}
                        {bet.payout - bet.amount}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 italic break-words">
                  " {bet.answer} "
                </p>
              </div>
            ))}
            {bets.length === 0 && (
              <p className="text-sm text-slate-600 py-2">
                Noch keine Wetten abgegeben.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 bg-slate-800/30 border-t border-slate-800">
        {topic.status === "open" ? (
          <div className="space-y-4">
            {!showBetForm && !isRefunding && (
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBetForm(true)}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95"
                >
                  {hasBet ? "Nochmal wetten" : "Wetten"}
                </button>
                {isCreator && (
                  <button
                    onClick={() => setIsResolving(true)}
                    className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all active:scale-95"
                  >
                    Auflösen
                  </button>
                )}
                {isCreator && (
                  <button
                    onClick={() => setIsRefunding(true)}
                    className="py-3 px-4 bg-red-900/30 hover:bg-red-900/50 text-red-400 font-bold rounded-xl transition-all active:scale-95 border border-red-900/50"
                    title="Schließen & alles erstatten"
                  >
                    <Undo2 size={18} />
                  </button>
                )}
              </div>
            )}

            {showBetForm && (
              <form
                onSubmit={placeBet}
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <input
                  name="answer"
                  type="text"
                  placeholder="Deine Antwort..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                  required
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <input
                    name="amount"
                    type="number"
                    defaultValue={0}
                    placeholder="Einsatz (LC)"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                    required
                    min="0"
                    max={currentUser.balance}
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    von {currentUser.balance} LC
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all"
                  >
                    Go
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBetForm(false)}
                    className="flex-1 py-2 bg-slate-800 text-slate-400 font-bold rounded-lg transition-all"
                  >
                    Stop
                  </button>
                </div>
              </form>
            )}

            {isRefunding && (
              <form
                onSubmit={refundTopic}
                className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                    Grund für das Schließen:
                  </label>
                  <input
                    name="refund_reason"
                    type="text"
                    placeholder="z.B. lässt sich nicht entscheiden"
                    className="w-full px-3 py-2 bg-slate-950 border border-red-900/50 rounded-lg text-sm text-white"
                    required
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg transition-all"
                  >
                    Schließen & erstatten
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRefunding(false)}
                    className="flex-1 py-2 bg-slate-800 text-slate-400 font-bold rounded-lg transition-all"
                  >
                    Abbruch
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="text-center py-2">
            <span
              className={`text-sm font-bold ${topic.status === "refunded" ? "text-red-500" : "text-slate-500"}`}
            >
              {topic.status === "refunded"
                ? "Geschlossen — Einsätze erstattet"
                : "Wette aufgelöst"}
            </span>
          </div>
        )}
      </div>

      {isResolving && (
        <ResolveTopicModal
          topic={topic}
          bets={bets}
          currentUser={currentUser}
          onClose={() => setIsResolving(false)}
          onResolved={() => {
            setIsResolving(false)
            onUpdate()
          }}
        />
      )}
    </div>
  )
}

/**
 * Der Auflösen-Dialog: den Pot von Hand auf die Mitspieler verteilen.
 *
 * Vorbelegt ist der Zustand "jeder bekommt seinen Einsatz zurück", damit man
 * meist nur eine Kleinigkeit ändern muss. Die Slider gleichen sich gegenseitig
 * aus, gesperrte Zeilen bleiben stehen — die Summe ist immer exakt der Pot.
 */
function ResolveTopicModal({
  topic,
  bets,
  currentUser,
  onClose,
  onResolved,
}: {
  topic: TopicEvent
  bets: TopicBet[]
  currentUser: User
  onClose: () => void
  onResolved: () => void
}) {
  // Bewusst eingefroren: verteilt wird auf den Stand beim Öffnen. Kommt
  // zwischendurch eine Wette dazu, lehnt der Server ab statt still umzurechnen.
  const [snapshot] = useState(() => bets)

  const participants = React.useMemo(() => {
    const byUser = new Map<
      number,
      { user_id: number; username: string; stake: number }
    >()
    for (const bet of snapshot) {
      const entry = byUser.get(bet.user_id) ?? {
        user_id: bet.user_id,
        username: bet.username,
        stake: 0,
      }
      entry.stake += bet.amount
      byUser.set(bet.user_id, entry)
    }
    return [...byUser.values()].sort((a, b) => b.stake - a.stake)
  }, [snapshot])

  const pot = participants.reduce((sum, p) => sum + p.stake, 0)
  const refundSplit = () =>
    Object.fromEntries(participants.map((p) => [p.user_id, p.stake]))

  const [alloc, setAlloc] = useState<Record<number, number>>(refundSplit)
  const [locked, setLocked] = useState<ReadonlySet<number>>(new Set())
  const [resolutionText, setResolutionText] = useState("")
  const [busy, setBusy] = useState(false)

  const assigned = participants.reduce(
    (sum, p) => sum + (alloc[p.user_id] ?? 0),
    0,
  )

  const setValue = (userId: number, value: number) =>
    setAlloc((prev) => redistribute(prev, userId, value, locked, pot))

  const giveAll = (userId: number) => {
    setLocked(new Set())
    setAlloc(
      Object.fromEntries(
        participants.map((p) => [p.user_id, p.user_id === userId ? pot : 0]),
      ),
    )
  }

  const toggleLock = (userId: number) =>
    setLocked((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const reset = () => {
    setLocked(new Set())
    setAlloc(refundSplit())
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch(`/api/topics/${topic.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          resolution_text: resolutionText,
          allocations: participants.map((p) => ({
            user_id: p.user_id,
            amount: alloc[p.user_id] ?? 0,
          })),
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Resolve failed")
      onResolved()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300"
      >
        <div className="p-6 pb-4 space-y-4 border-b border-slate-800">
          <div>
            <h3 className="text-xl font-bold text-white">Wette auflösen</h3>
            <p className="text-sm text-slate-500 mt-0.5">{topic.description}</p>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Was ist passiert?
            </label>
            <input
              value={resolutionText}
              onChange={(e) => setResolutionText(e.target.value)}
              placeholder="z.B. Bayern hat 2:1 gewonnen"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {participants.length === 0 && (
            <p className="text-center text-slate-500 py-6 text-sm">
              Es wurden keine Wetten abgegeben — hier gibt es nichts zu
              verteilen.
            </p>
          )}
          {participants.map((p) => {
            const value = alloc[p.user_id] ?? 0
            const delta = value - p.stake
            const isLocked = locked.has(p.user_id)
            return (
              <div
                key={p.user_id}
                className={`rounded-2xl border p-4 space-y-3 transition-colors ${isLocked ? "bg-blue-950/20 border-blue-800/40" : "bg-slate-950/50 border-slate-800/50"}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-white truncate">
                    {p.username}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">
                    Einsatz {p.stake} LC
                    {delta !== 0 && (
                      <span
                        className={`ml-1.5 font-black ${delta > 0 ? "text-green-400" : "text-red-400"}`}
                      >
                        {delta > 0 ? "+" : ""}
                        {delta}
                      </span>
                    )}
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={Math.max(pot, 1)}
                  value={value}
                  disabled={pot === 0 || isLocked}
                  onChange={(e) => setValue(p.user_id, Number(e.target.value))}
                  style={
                    {
                      "--pot-pct": `${pot > 0 ? (value / pot) * 100 : 0}%`,
                    } as React.CSSProperties
                  }
                  className="pot-slider"
                />

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={pot}
                    value={value}
                    disabled={pot === 0 || isLocked}
                    onChange={(e) =>
                      setValue(p.user_id, Number(e.target.value) || 0)
                    }
                    onFocus={(e) => e.target.select()}
                    className="w-20 px-2 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white text-center disabled:opacity-40"
                  />
                  <span className="text-xs text-slate-500">LC</span>
                  <button
                    type="button"
                    onClick={() => giveAll(p.user_id)}
                    disabled={pot === 0}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold rounded-lg transition-all active:scale-95 disabled:opacity-40"
                  >
                    Alles
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLock(p.user_id)}
                    title={isLocked ? "Entsperren" : "Wert festhalten"}
                    className={`h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center transition-all ${isLocked ? "bg-blue-600/20 border-blue-500/40 text-blue-400" : "bg-slate-800/60 border-slate-700 text-slate-500 hover:text-slate-300"}`}
                  >
                    {isLocked ? <Lock size={16} /> : <LockOpen size={16} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="p-6 pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors"
            >
              <RotateCcw size={14} /> Zurücksetzen
            </button>
            <span className="text-sm">
              <span className="text-slate-500">Verteilt </span>
              <span
                className={`font-black ${assigned === pot ? "text-green-400" : "text-red-400"}`}
              >
                {assigned} / {pot} LC
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || assigned !== pot}
              className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              Auszahlen
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold rounded-xl transition-all"
            >
              Abbruch
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function LeaderboardPage({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/leaderboard")
        const data = await res.json()
        setUsers(data)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchLeaderboard()
  }, [])

  if (loading) {
    return <div className="text-center py-20 text-slate-500">Lädt...</div>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-3xl font-bold text-white flex items-center gap-2">
          <Trophy className="text-yellow-500" size={32} />
          Rangliste
        </h2>
      </div>

      <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="divide-y divide-slate-800">
          {users.map((u, index) => {
            const isTop3 = index < 3
            const rankColors = [
              "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
              "bg-slate-300/20 text-slate-300 border-slate-300/30",
              "bg-amber-700/20 text-amber-500 border-amber-700/30",
            ]
            const medalEmojis = ["🥇", "🥈", "🥉"]
            const isCurrentUser = u.id === currentUser.id

            return (
              <div
                key={u.id}
                className={`p-6 flex items-center justify-between hover:bg-slate-800/30 transition-all ${
                  isCurrentUser
                    ? "bg-blue-900/10 border-y border-blue-900/50"
                    : ""
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-black border text-lg ${
                      isTop3
                        ? rankColors[index]
                        : "bg-slate-800 text-slate-400 border-slate-700"
                    }`}
                  >
                    {isTop3 ? medalEmojis[index] : index + 1}
                  </div>
                  <div>
                    <span
                      className={`font-bold text-lg block ${isCurrentUser ? "text-blue-400" : "text-white"}`}
                    >
                      {u.username}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-medium">
                          Du
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-yellow-500 block">
                    {u.balance} LC
                  </span>
                </div>
              </div>
            )
          })}
          {users.length === 0 && (
            <p className="p-12 text-center text-slate-500">
              Noch keine Benutzer registriert.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
