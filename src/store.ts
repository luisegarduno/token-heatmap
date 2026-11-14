// history.jsonl: one line per day, provider and machine, sorted by those three.
//
//   {"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":{…},"models":{"claude-opus-5-5":{…}}}
//
// `tokens` is the sum of `models`, and `models` is left out with `setup --no-models`. Every
// count is a whole number, 0 or more.

import { type HistoryLine, TOKEN_TYPES, type Tokens } from "./providers/provider.ts"

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
      const key = JSON.stringify([line.date, line.provider, line.machine])
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
  const sum = Object.values(line.models).reduce(add, { input: 0, output: 0, cache_write: 0, cache_read: 0 })
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

const add = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache_write: a.cache_write + b.cache_write,
  cache_read: a.cache_read + b.cache_read,
})
