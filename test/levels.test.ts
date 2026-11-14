import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { cutoffs, levels } from "../src/levels.ts"
import { parseHistory } from "../src/store.ts"

const counts = (list: number[]) => [0, 1, 2, 3, 4].map((level) => list.filter((x) => x === level).length)

test("the design's example", () => {
  assert.deepEqual(levels([0, 5, 1, 3, 0, 2, 4, 8, 7, 6]), [0, 3, 1, 2, 0, 1, 2, 4, 4, 3])
})

test("no usage: no cut-offs, and every day is level 0", () => {
  assert.deepEqual(cutoffs([]), [])
  assert.deepEqual(levels([]), [])
  assert.deepEqual(cutoffs([0, 0, 0]), [])
  assert.deepEqual(levels([0, 0, 0]), [0, 0, 0])
})

test("cut-offs are the 25th, 50th and 75th percentile of the days with usage, by rank", () => {
  assert.deepEqual(cutoffs([8, 0, 1, 7, 2, 0, 6, 3, 5, 4]), [2, 4, 6])
  assert.deepEqual(levels([8, 0, 1, 7, 2, 0, 6, 3, 5, 4]), [4, 0, 1, 4, 1, 0, 3, 2, 3, 2])
})

test("any usage is at least level 1", () => {
  assert.deepEqual(levels([0, 1]), [0, 1])
  assert.deepEqual(levels([0, 1, 1_000_000_000_000]), [0, 1, 3])
  assert.deepEqual(levels([5, 5, 5, 5]), [1, 1, 1, 1])
})

test("one huge day does not push the other days down into level 1", () => {
  const totals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1_000_000_000_000]
  assert.deepEqual(cutoffs(totals), [4, 7, 10])
  assert.deepEqual(counts(levels(totals)), [0, 4, 3, 3, 3])
})

test("the made-up year: cut-offs and days per level", () => {
  const history = parseHistory(readFileSync(new URL("fixtures/history.jsonl", import.meta.url), "utf8"))
  const totals = new Map<string, number>()
  for (const line of history) {
    if (line.date < "2025-11-09" || line.date > "2026-11-13") continue
    const t = line.tokens
    totals.set(line.date, (totals.get(line.date) ?? 0) + t.input + t.output + t.cache_write + t.cache_read)
  }
  const year = [...totals.values()]
  const window = [...year, ...new Array<number>(370 - year.length).fill(0)]
  assert.equal(
    window.reduce((a, b) => a + b),
    9_182_417_306,
  )
  assert.deepEqual(cutoffs(window), [5_837_664, 15_906_480, 38_525_867])
  assert.deepEqual(counts(levels(window)), [114, 64, 64, 64, 64])
})
