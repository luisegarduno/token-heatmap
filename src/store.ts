// history.jsonl: one line per day, provider and machine, sorted by those three.
//
//   {"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":{…},"models":{"claude-opus-5-5":{…}}}
//
// `tokens` is the sum of `models`, and `models` is left out with `setup --no-models`. Every
// count is a whole number, 0 or more. A recorded day never goes down: merge() replaces a count
// only with a higher one, so the history outlives the transcripts it came from.

import {
  addTokens,
  type DayRecord,
  type HistoryLine,
  NO_TOKENS,
  TOKEN_TYPES,
  type Tokens,
  totalOf,
} from "./providers/provider.ts"

const LINE_KEYS: readonly string[] = ["date", "provider", "machine", "tokens", "models"]

/** A line of history.jsonl that cannot be read. `line` counts from 1. */
export class HistoryError extends Error {
  readonly line: number

  constructor(line: number, problem: string) {
    super(`line ${line}: ${problem}`)
    this.name = "HistoryError"
    this.line = line
  }
}

/** True for a day written YYYY-MM-DD that exists on the calendar. */
export function isDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const dayFormats = new Map<string, Intl.DateTimeFormat>()

/** The day, YYYY-MM-DD, that `instant` falls on in an IANA time zone such as "America/Los_Angeles". */
export function localDate(instant: Date, timeZone: string): string {
  let format = dayFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    dayFormats.set(timeZone, format)
  }
  const parts = format.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`
}

/**
 * Reads history.jsonl. Blank lines are skipped. A line it cannot read throws a HistoryError that
 * names the line: one that is not JSON, has a key it does not know or lacks one it needs, holds
 * a count that is not a whole number of 0 or more, has `tokens` that are not the sum of
 * `models`, or repeats the date, provider and machine of an earlier line.
 */
export function parseHistory(text: string): HistoryLine[] {
  const lines: HistoryLine[] = []
  const firstLine = new Map<string, number>()
  text
    .replace(/^﻿/, "")
    .split("\n")
    .forEach((raw, index) => {
      const n = index + 1
      if (raw.trim() === "") return
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        throw new HistoryError(n, "not JSON")
      }
      const line = readLine(value, n)
      const key = keyOf(line)
      const earlier = firstLine.get(key)
      if (earlier !== undefined) {
        throw new HistoryError(
          n,
          `a second line for ${line.date}, ${line.provider}, ${line.machine}; line ${earlier} has it`,
        )
      }
      firstLine.set(key, n)
      lines.push(line)
    })
  return lines
}

/**
 * Writes history.jsonl: sorted by date, provider and machine, one compact JSON object per line,
 * keys in a fixed order and model names sorted. Only the keys of a HistoryLine are written.
 */
export function formatHistory(lines: readonly HistoryLine[]): string {
  return [...lines]
    .sort((a, b) => compare(a.date, b.date) || compare(a.provider, b.provider) || compare(a.machine, b.machine))
    .map(({ date, provider, machine, tokens, models }) => {
      const line: HistoryLine = { date, provider, machine, tokens: ordered(tokens) }
      if (models) {
        line.models = Object.fromEntries(
          Object.entries(models)
            .sort(([a], [b]) => compare(a, b))
            .map(([name, counts]) => [name, ordered(counts)]),
        )
      }
      return `${JSON.stringify(line)}\n`
    })
    .join("")
}

/**
 * Adds a collector's records to the history, as the lines of `machine`. A recorded day never
 * goes down:
 *
 * - A record with `models` replaces a model's counts only with a higher total, and a model the
 *   record lacks keeps its counts. `tokens` is then the sum of `models`.
 * - A record without `models` (`setup --no-models`) replaces the line only with a higher total,
 *   and its line holds only `tokens`. So does a record that meets a line of the other kind.
 *
 * Lines of other machines and other providers are left as they are, and neither argument is
 * changed. A record's `tokens` is read only when it has no `models`.
 */
export function merge(history: readonly HistoryLine[], records: readonly DayRecord[], machine: string): HistoryLine[] {
  const lines = [...history]
  const index = new Map(lines.map((line, i) => [keyOf(line), i]))
  for (const record of records) {
    const recorded: HistoryLine = record.models
      ? { date: record.date, provider: record.provider, machine, ...splitByModel(Object.entries(record.models)) }
      : { date: record.date, provider: record.provider, machine, tokens: ordered(record.tokens) }
    const key = keyOf(recorded)
    const i = index.get(key)
    if (i === undefined) {
      index.set(key, lines.length)
      lines.push(recorded)
    } else {
      lines[i] = mergeLine(lines[i], recorded)
    }
  }
  return lines
}

function mergeLine(line: HistoryLine, recorded: HistoryLine): HistoryLine {
  if (line.models && recorded.models) {
    const models = new Map(Object.entries(line.models))
    for (const [name, counts] of Object.entries(recorded.models)) {
      const kept = models.get(name)
      if (!kept || totalOf(counts) > totalOf(kept)) models.set(name, counts)
    }
    return { ...line, ...splitByModel([...models]) }
  }
  // One of the two has no split by model, so the whole day is compared.
  return totalOf(recorded.tokens) > totalOf(line.tokens) ? recorded : line
}

/** `models` from name and counts pairs, and `tokens` as their sum. A name such as "__proto__" stays a name. */
function splitByModel(entries: [string, Tokens][]): { tokens: Tokens; models: Record<string, Tokens> } {
  return {
    tokens: entries.reduce((sum, [, counts]) => addTokens(sum, counts), NO_TOKENS),
    models: Object.fromEntries(entries.map(([name, counts]) => [name, ordered(counts)])),
  }
}

const keyOf = (line: HistoryLine) => JSON.stringify([line.date, line.provider, line.machine])

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const ordered = (t: Tokens): Tokens => ({
  input: t.input,
  output: t.output,
  cache_write: t.cache_write,
  cache_read: t.cache_read,
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function readLine(value: unknown, n: number): HistoryLine {
  if (!isObject(value)) throw new HistoryError(n, "not a JSON object")
  for (const key of Object.keys(value)) {
    if (!LINE_KEYS.includes(key)) throw new HistoryError(n, `unknown key ${JSON.stringify(key)}`)
  }
  const { date, provider, machine, tokens, models } = value
  if (typeof date !== "string" || !isDate(date)) throw new HistoryError(n, "date is not a day written YYYY-MM-DD")
  if (typeof provider !== "string" || provider === "") throw new HistoryError(n, "provider is not a name")
  if (typeof machine !== "string" || machine === "") throw new HistoryError(n, "machine is not an id")
  const line: HistoryLine = { date, provider, machine, tokens: readTokens(tokens, "tokens", n) }
  if (models === undefined) return line

  if (!isObject(models)) throw new HistoryError(n, "models is not an object")
  // Object.fromEntries makes each name an own key, so a name such as "__proto__" stays a name.
  line.models = Object.fromEntries(
    Object.entries(models).map(([name, counts]) => {
      if (name === "") throw new HistoryError(n, "a model has no name")
      return [name, readTokens(counts, `models[${JSON.stringify(name)}]`, n)]
    }),
  )
  const sum = Object.values(line.models).reduce(addTokens, NO_TOKENS)
  for (const type of TOKEN_TYPES) {
    if (sum[type] !== line.tokens[type]) throw new HistoryError(n, `tokens.${type} is not the sum of models`)
  }
  return line
}

function readTokens(value: unknown, where: string, n: number): Tokens {
  if (!isObject(value)) throw new HistoryError(n, `${where} is not an object`)
  for (const key of Object.keys(value)) {
    if (!(TOKEN_TYPES as readonly string[]).includes(key)) {
      throw new HistoryError(n, `${where} has an unknown key ${JSON.stringify(key)}`)
    }
  }
  for (const type of TOKEN_TYPES) {
    const count = value[type]
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new HistoryError(n, `${where}.${type} is not a whole number of 0 or more`)
    }
  }
  return ordered(value as Tokens)
}
