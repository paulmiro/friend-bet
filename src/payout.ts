/**
 * Geld-Mathematik für freie Themen-Wetten.
 *
 * Bewusst frei von DB und React, damit die eine Invariante, auf die es hier
 * ankommt, testbar bleibt: es wird nie ein LC erfunden oder vernichtet.
 */

/**
 * Verteilt `total` auf `weights` und gibt ganzzahlige Anteile zurück, die exakt
 * `total` ergeben (Hare-Niemeyer / größte Reste).
 *
 * Sind alle Gewichte 0, wird gleichmäßig verteilt — sonst könnten Spieler, die
 * nur 0-LC-Wetten abgegeben haben, kein Geld zugeteilt bekommen.
 */
export function largestRemainder(weights: number[], total: number): number[] {
  const n = weights.length
  if (n === 0) return []
  if (total <= 0) return new Array(n).fill(0)

  const weightSum = weights.reduce((sum, w) => sum + w, 0)
  const raw =
    weightSum > 0
      ? weights.map((w) => (total * w) / weightSum)
      : weights.map(() => total / n)

  const shares = raw.map(Math.floor)
  let rest = total - shares.reduce((sum, s) => sum + s, 0)

  // Die Reste sind je < 1, ihre Summe also < n — ein Durchlauf reicht immer.
  const byRemainder = raw
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
      weight: weights[index] ?? 0,
    }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction || b.weight - a.weight || a.index - b.index,
    )

  for (const { index } of byRemainder) {
    if (rest <= 0) break
    shares[index]!++
    rest--
  }

  return shares
}

/**
 * Verteilt den einem Spieler zugesprochenen Betrag auf dessen einzelne Wetten,
 * proportional zum Einsatz. Der Pot wird beim Auflösen pro Spieler zugeteilt,
 * gespeichert wird der Payout aber pro Wette — das hier ist die Brücke.
 */
export function splitAcrossBets(
  bets: { id: number; amount: number }[],
  total: number,
): Map<number, number> {
  const shares = largestRemainder(
    bets.map((bet) => bet.amount),
    total,
  )
  return new Map(bets.map((bet, index) => [bet.id, shares[index] ?? 0]))
}

/**
 * Der Auto-Ausgleich hinter den Slidern im Auflösen-Dialog.
 *
 * Zieht man den Slider eines Spielers auf `value`, wird der Rest des Pots auf
 * die *nicht gesperrten* anderen Spieler verteilt — im Verhältnis ihrer
 * aktuellen Werte, damit eine bereits eingestellte Aufteilung ihre Form behält.
 * Gesperrte Spieler bleiben unangetastet.
 *
 * Nach jedem Aufruf gilt: Summe aller Werte === `pot`.
 */
export function redistribute(
  current: Record<number, number>,
  changedId: number,
  value: number,
  locked: ReadonlySet<number>,
  pot: number,
): Record<number, number> {
  const others = Object.keys(current)
    .map(Number)
    .filter((id) => id !== changedId)
  const lockedOthers = others.filter((id) => locked.has(id))
  const freeOthers = others.filter((id) => !locked.has(id))

  const lockedSum = lockedOthers.reduce((sum, id) => sum + (current[id] ?? 0), 0)
  const cap = Math.max(0, pot - lockedSum)

  const next = { ...current }

  // Ohne freien Gegenpart lässt sich nichts ausgleichen: der Wert ist fixiert.
  if (freeOthers.length === 0) {
    next[changedId] = cap
    return next
  }

  const own = Math.min(Math.max(Math.round(value), 0), cap)
  next[changedId] = own

  const shares = largestRemainder(
    freeOthers.map((id) => current[id] ?? 0),
    cap - own,
  )
  freeOthers.forEach((id, index) => {
    next[id] = shares[index] ?? 0
  })

  return next
}
