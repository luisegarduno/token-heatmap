// merge(): a collector's records into history.jsonl. A recorded day never goes down.

import assert from "node:assert/strict"
import { test } from "node:test"
import { addTokens, type DayRecord, type HistoryLine, NO_TOKENS, type Tokens } from "../src/providers/provider.ts"
import { formatHistory, merge, parseHistory } from "../src/store.ts"

const t = (cache_read: number, output = 0): Tokens => ({ input: 0, output, cache_write: 0, cache_read })
const MACHINE = "k3f9a2"

/** A record of claude-code on `date`, split by model. */
const byModel = (date: string, models: Record<string, Tokens>): DayRecord => ({
  date,
  provider: "claude-code",
  tokens: Object.values(models).reduce(addTokens, NO_TOKENS),
  models,
})
/** A record of claude-code on `date` with no split by model. */
const total = (date: string, tokens: Tokens): DayRecord => ({ date, provider: "claude-code", tokens })
const line = (record: DayRecord, machine = MACHINE): HistoryLine => ({ ...record, machine })

test("a new day becomes a line of this machine, with tokens the sum of models", () => {
  const record = byModel("2026-11-12", { "claude-opus-5-5": t(100, 5), "claude-sonnet-5-5": t(20, 1) })
  assert.deepEqual(merge([], [record], MACHINE), [
    {
      date: "2026-11-12",
      provider: "claude-code",
      machine: MACHINE,
      tokens: t(120, 6),
      models: { "claude-opus-5-5": t(100, 5), "claude-sonnet-5-5": t(20, 1) },
    },
  ])
})

test("a model's day is replaced only by a higher total, and a model the record lacks stays", () => {
  const history = [line(byModel("2026-11-12", { a: t(100), b: t(50), c: t(10) }))]
  const record = byModel("2026-11-12", { a: t(90, 20), b: t(40), d: t(5) }) // a: 110 > 100; b: 40 < 50; no c
  assert.deepEqual(merge(history, [record], MACHINE), [
    line(byModel("2026-11-12", { a: t(90, 20), b: t(50), c: t(10), d: t(5) })),
  ])
})

test("a model's day with the same total keeps the counts it has", () => {
  const history = [line(byModel("2026-11-12", { a: t(100) }))]
  assert.deepEqual(merge(history, [byModel("2026-11-12", { a: t(99, 1) })], MACHINE), history)
})

test("without models, a line holds only tokens and is replaced only by a higher total", () => {
  const first = merge([], [total("2026-11-12", t(100))], MACHINE)
  assert.deepEqual(first, [line(total("2026-11-12", t(100)))])
  assert.equal("models" in first[0], false)
  assert.deepEqual(merge(first, [total("2026-11-12", t(90))], MACHINE), first)
  assert.deepEqual(merge(first, [total("2026-11-12", t(100))], MACHINE), first)
  assert.deepEqual(merge(first, [total("2026-11-12", t(90, 20))], MACHINE), [line(total("2026-11-12", t(90, 20)))])
})

test("a record that meets a line of the other kind replaces it only with a higher total", () => {
  const split = line(byModel("2026-11-12", { a: t(60), b: t(40) }))
  const whole = line(total("2026-11-12", t(100)))
  assert.deepEqual(merge([split], [total("2026-11-12", t(99))], MACHINE), [split])
  assert.deepEqual(merge([split], [total("2026-11-12", t(101))], MACHINE), [line(total("2026-11-12", t(101)))])
  assert.deepEqual(merge([whole], [byModel("2026-11-12", { a: t(99) })], MACHINE), [whole])
  assert.deepEqual(merge([whole], [byModel("2026-11-12", { a: t(101) })], MACHINE), [
    line(byModel("2026-11-12", { a: t(101) })),
  ])
})

test("lines of other machines, providers and days are left as they are", () => {
  const history: HistoryLine[] = [
    line(total("2026-11-12", t(5)), "p7m2x1"),
    { ...line(total("2026-11-12", t(5))), provider: "another-tool" },
    line(byModel("2026-11-11", { a: t(5) })),
  ]
  const merged = merge(history, [byModel("2026-11-12", { a: t(1) })], MACHINE)
  assert.deepEqual(merged, [...history, line(byModel("2026-11-12", { a: t(1) }))])
})

test("neither argument is changed", () => {
  const history = [line(byModel("2026-11-12", { a: t(100) }))]
  const records = [byModel("2026-11-12", { a: t(200), b: t(1) }), byModel("2026-11-13", { a: t(1) })]
  const before = structuredClone({ history, records })
  merge(history, records, MACHINE)
  assert.deepEqual({ history, records }, before)
})

test("records of several providers and days, in any order, give lines that read back", () => {
  const records: DayRecord[] = [
    byModel("2026-11-13", { a: t(3) }),
    { ...byModel("2026-11-12", { "fake-model": t(7) }), provider: "fake-tool" },
    byModel(
      "2026-11-12",
      Object.fromEntries([
        ["a", t(1)],
        ["__proto__", t(2)],
      ]),
    ),
  ]
  const merged = merge([], records, MACHINE)
  const text = formatHistory(merged)
  assert.deepEqual(parseHistory(text), parseHistory(formatHistory(merged.toReversed())))
  assert.deepEqual(
    parseHistory(text).map((l) => [l.date, l.provider, l.tokens.cache_read]),
    [
      ["2026-11-12", "claude-code", 3],
      ["2026-11-12", "fake-tool", 7],
      ["2026-11-13", "claude-code", 3],
    ],
  )
  // A model named __proto__ stays a model, here and when merged again.
  const again = merge(merged, [byModel("2026-11-12", Object.fromEntries([["__proto__", t(5)]]))], MACHINE)
  assert.deepEqual(
    parseHistory(formatHistory(again))[0].models,
    Object.fromEntries([
      ["__proto__", t(5)],
      ["a", t(1)],
    ]),
  )
})

test("a record's tokens is read only when it has no models", () => {
  const record: DayRecord = { date: "2026-11-12", provider: "claude-code", tokens: t(999), models: { a: t(1) } }
  assert.deepEqual(merge([], [record], MACHINE)[0].tokens, t(1))
})
