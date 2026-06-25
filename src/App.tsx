import React, { useState, useEffect, useRef } from "react"
import {
  Clock,
  Plus,
  Wallet,
  LogOut,
  CheckCircle2,
  User as UserIcon,
} from "lucide-react"

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
  const [view, setView] = useState<
    "dashboard" | "create" | "account" | "transparency"
  >("dashboard")
  const [username, setUsername] = useState("")
  const [notification, setNotification] = useState<string | null>(null)
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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    ws.current = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.current.onmessage = (message) => {
      const { type, data } = JSON.parse(message.data)
      if (type === "new_event") {
        setEvents((prev) => [data, ...prev])
        showNotification(`New Event: ${data.description}`)
      } else if (
        type === "event_resolved" ||
        type === "event_cancelled" ||
        type === "bonus_awarded" ||
        type === "bet_placed"
      ) {
        fetchEvents()
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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1
            onClick={() => setView("dashboard")}
            className="text-2xl font-black text-white cursor-pointer hover:text-blue-400 transition-colors"
          >
            {friendName}-Bet
          </h1>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors"
              onClick={() => setView("account")}
            >
              <Wallet size={18} className="text-yellow-500" />
              <span className="font-bold text-yellow-500">
                {user.balance} LC
              </span>
            </div>
            <div
              className="hidden sm:flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-700 transition-colors"
              onClick={() => setView("account")}
            >
              <UserIcon size={18} className="text-blue-400" />
              <span className="font-medium">{user.username}</span>
            </div>
            <button
              onClick={logout}
              className="p-2 text-slate-400 hover:text-red-400 transition-colors"
            >
              <LogOut size={20} />
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
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  currentUser={user}
                  friendName={friendName}
                  onUpdate={() => {
                    fetchEvents()
                    refreshUser(user.id)
                  }}
                />
              ))}
              {events.length === 0 && (
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
                  Beschreibung
                </label>
                <input
                  name="description"
                  placeholder={`z.B. ${friendName} kommt zur Mensa`}
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  required
                />
              </div>
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
      </main>

      <footer className="border-t border-slate-900 mt-20 bg-slate-950 py-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setView("transparency")}
              className="hover:text-blue-400 transition-colors"
            >
              Transparenz & Formeln
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
                  <div className="space-y-1">
                    <span className="text-white font-bold block">
                      {bet.event_description}
                    </span>
                    <span className="text-slate-500 text-sm">
                      Tipp:{" "}
                      {new Date(bet.bet_arrival_time).toLocaleTimeString(
                        "de-DE",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="text-slate-400 font-medium block">
                      -{bet.amount} LC
                    </span>
                    {bet.event_status === "cancelled" ? (
                      <span className="text-red-400 text-sm font-bold bg-red-500/10 px-2 py-0.5 rounded">
                        Erstattet
                      </span>
                    ) : bet.actual_arrival_time ? (
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
        body: JSON.stringify({ cancel_reason: form.cancel_reason.value, user_id: currentUser.id }),
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
          <span
            className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${event.status === "open" ? "bg-green-500/10 text-green-500" : event.status === "cancelled" ? "bg-red-500/10 text-red-400" : "bg-slate-800 text-slate-500"}`}
          >
            {event.status === "open" ? "Aktiv" : event.status === "cancelled" ? "Storniert" : "Beendet"}
          </span>
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
              <span className="text-sm font-bold">Grund: {event.cancel_reason}</span>
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
            <span className={`text-sm font-bold ${event.status === "cancelled" ? "text-red-500" : "text-slate-500"}`}>
              {event.status === "cancelled" ? "Event Storniert — Einsätze erstattet" : "Event Abgeschlossen"}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
