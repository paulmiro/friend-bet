import { describe, expect, it } from "bun:test"
import { largestRemainder, redistribute, splitAcrossBets } from "./payout"

const sum = (values: number[]) => values.reduce((acc, v) => acc + v, 0)
const total = (record: Record<number, number>) => sum(Object.values(record))

describe("largestRemainder", () => {
  it("keeps the total exact despite rounding", () => {
    expect(sum(largestRemainder([1, 1, 1], 10))).toBe(10)
    expect(sum(largestRemainder([7, 3], 100))).toBe(100)
    expect(largestRemainder([1, 1], 10)).toEqual([5, 5])
  })

  it("splits evenly when every weight is zero", () => {
    expect(largestRemainder([0, 0, 0], 10)).toEqual([4, 3, 3])
    expect(sum(largestRemainder([0, 0, 0], 10))).toBe(10)
  })

  it("handles empty and zero totals", () => {
    expect(largestRemainder([], 10)).toEqual([])
    expect(largestRemainder([5, 5], 0)).toEqual([0, 0])
  })

  it("never invents or loses value on random input", () => {
    for (let run = 0; run < 500; run++) {
      const n = 1 + Math.floor(Math.random() * 6)
      const weights = Array.from({ length: n }, () =>
        Math.floor(Math.random() * 40),
      )
      const target = Math.floor(Math.random() * 500)
      const shares = largestRemainder(weights, target)
      expect(sum(shares)).toBe(target)
      expect(shares.every((s) => s >= 0)).toBe(true)
    }
  })
})

describe("splitAcrossBets", () => {
  it("splits a player's award proportionally to their stakes", () => {
    const shares = splitAcrossBets(
      [
        { id: 1, amount: 10 },
        { id: 2, amount: 30 },
      ],
      20,
    )
    expect(shares.get(1)).toBe(5)
    expect(shares.get(2)).toBe(15)
  })

  it("still pays a player whose bets were all 0 LC", () => {
    const shares = splitAcrossBets(
      [
        { id: 1, amount: 0 },
        { id: 2, amount: 0 },
      ],
      7,
    )
    expect(sum([...shares.values()])).toBe(7)
  })

  it("returns nothing for a player without bets", () => {
    expect(splitAcrossBets([], 0).size).toBe(0)
  })
})

describe("redistribute", () => {
  const pot = 30

  it("keeps the pot exact when a slider moves", () => {
    const next = redistribute({ 1: 10, 2: 10, 3: 10 }, 1, 30, new Set(), pot)
    expect(next).toEqual({ 1: 30, 2: 0, 3: 0 })
    expect(total(next)).toBe(pot)
  })

  it("spreads the remainder proportionally to current values", () => {
    const next = redistribute({ 1: 10, 2: 15, 3: 5 }, 1, 10, new Set(), pot)
    expect(next[1]).toBe(10)
    expect(next[2]).toBe(15)
    expect(next[3]).toBe(5)
  })

  it("spreads evenly when the other values are all zero", () => {
    const next = redistribute({ 1: 30, 2: 0, 3: 0 }, 1, 0, new Set(), pot)
    expect(next[1]).toBe(0)
    expect(next[2]! + next[3]!).toBe(30)
    expect(next[2]).toBe(15)
  })

  it("never touches locked players", () => {
    const next = redistribute({ 1: 10, 2: 10, 3: 10 }, 1, 20, new Set([2]), pot)
    expect(next[2]).toBe(10)
    expect(next[1]).toBe(20)
    expect(next[3]).toBe(0)
    expect(total(next)).toBe(pot)
  })

  it("clamps against what the locks already claim", () => {
    const next = redistribute({ 1: 5, 2: 20, 3: 5 }, 1, 30, new Set([2]), pot)
    expect(next[1]).toBe(10)
    expect(next[2]).toBe(20)
    expect(next[3]).toBe(0)
  })

  it("pins the value when every other player is locked", () => {
    const next = redistribute({ 1: 10, 2: 20 }, 1, 25, new Set([2]), pot)
    expect(next).toEqual({ 1: 10, 2: 20 })
  })

  it("pins a lone participant to the whole pot", () => {
    expect(redistribute({ 1: 30 }, 1, 5, new Set(), pot)).toEqual({ 1: 30 })
  })

  it("copes with an empty pot", () => {
    const next = redistribute({ 1: 0, 2: 0 }, 1, 10, new Set(), 0)
    expect(next).toEqual({ 1: 0, 2: 0 })
  })

  it("conserves the pot across random drag sequences", () => {
    for (let run = 0; run < 300; run++) {
      const ids = [1, 2, 3, 4]
      const stakes = ids.map(() => Math.floor(Math.random() * 25))
      const potSize = sum(stakes)
      let alloc: Record<number, number> = Object.fromEntries(
        ids.map((id, i) => [id, stakes[i]!]),
      )
      const locked = new Set<number>()

      for (let step = 0; step < 6; step++) {
        const id = ids[Math.floor(Math.random() * ids.length)]!
        if (Math.random() < 0.25) {
          if (locked.has(id)) locked.delete(id)
          else locked.add(id)
        }
        if (locked.has(id)) continue
        alloc = redistribute(
          alloc,
          id,
          Math.floor(Math.random() * (potSize + 5)),
          locked,
          potSize,
        )
        expect(total(alloc)).toBe(potSize)
        expect(Object.values(alloc).every((v) => v >= 0)).toBe(true)
      }
    }
  })
})
