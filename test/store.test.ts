import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import type { HistoryLine } from "../src/providers/provider.ts"
import { formatHistory, HistoryError, isDate, parseHistory } from "../src/store.ts"

const FIXTURE = readFileSync(new URL("fixtures/history.jsonl", import.meta.url), "utf8")

const T = '{"input":1,"output":2,"cache_write":3,"cache_read":4}'
const LINE = `{"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":${T}}`

test("the made-up year reads, and writes back byte for byte", () => {
  const history = parseHistory(FIXTURE)
  assert.equal(history.length, 262)
  assert.equal(formatHistory(history), FIXTURE)
  assert.deepEqual(
    history.filter((line) => line.machine === "p7m2x1").map((line) => [line.date, "models" in line]),
    [
      ["2026-07-11", false],
      ["2026-08-02", false],
      ["2026-08-25", false],
    ],
  )
})

test("writes lines sorted by date, provider and machine, keys in a fixed order and model names sorted", () => {
  const tokens = { cache_read: 4, cache_write: 3, output: 2, input: 1 }
  const lines = [
    { machine: "b", provider: "claude-code", date: "2026-11-12", tokens },
    { date: "2026-11-12", provider: "claude-code", machine: "a", tokens: { ...tokens, input: 2 } },
    { date: "2026-11-12", provider: "another", machine: "z", tokens },
    {
      date: "2026-11-11",
      provider: "claude-code",
      machine: "a",
      models: { "claude-sonnet-5-5": tokens, "claude-opus-5-5": tokens },
      tokens: { input: 2, output: 4, cache_write: 6, cache_read: 8 },
    },
  ] satisfies HistoryLine[]
  assert.equal(
    formatHistory(lines),
    [
      `{"date":"2026-11-11","provider":"claude-code","machine":"a","tokens":{"input":2,"output":4,"cache_write":6,"cache_read":8},"models":{"claude-opus-5-5":${T},"claude-sonnet-5-5":${T}}}`,
      `{"date":"2026-11-12","provider":"another","machine":"z","tokens":${T}}`,
      `{"date":"2026-11-12","provider":"claude-code","machine":"a","tokens":{"input":2,"output":2,"cache_write":3,"cache_read":4}}`,
      `{"date":"2026-11-12","provider":"claude-code","machine":"b","tokens":${T}}`,
      "",
    ].join("\n"),
  )
  assert.deepEqual(parseHistory(formatHistory(lines)), parseHistory(formatHistory(lines.toReversed())))
})

test("writes only the keys of a history line", () => {
  const line = {
    date: "2026-11-12",
    provider: "claude-code",
    machine: "k3f9a2",
    tokens: JSON.parse(T),
    prompt: "secret",
  }
  assert.equal(formatHistory([line]), `${LINE}\n`)
})

test("an empty file is an empty history; blank lines, CRLF and a byte order mark are read", () => {
  assert.deepEqual(parseHistory(""), [])
  assert.equal(formatHistory([]), "")
  const lines = parseHistory(`﻿${LINE}\r\n\r\n  \n${LINE.replace("2026-11-12", "2026-11-13")}\r\n`)
  assert.deepEqual(
    lines.map((line) => line.date),
    ["2026-11-12", "2026-11-13"],
  )
})

test("a line it cannot read throws, with the line number", () => {
  const withTokens = (tokens: string) => LINE.replace(T, tokens)
  const cases: [string, string][] = [
    ["not json", "line 1: not JSON"],
    [`${LINE}\n{"date":`, "line 2: not JSON"],
    ["[1, 2]", "line 1: not a JSON object"],
    ["null", "line 1: not a JSON object"],
    [LINE.replace("}}", '},"cost":1}'), 'line 1: unknown key "cost"'],
    [LINE.replace('"date":"2026-11-12",', ""), "line 1: date is not a day written YYYY-MM-DD"],
    [LINE.replace("2026-11-12", "2026-02-30"), "line 1: date is not a day written YYYY-MM-DD"],
    [LINE.replace("2026-11-12", "2026-11-1"), "line 1: date is not a day written YYYY-MM-DD"],
    [LINE.replace('"claude-code"', '""'), "line 1: provider is not a name"],
    [LINE.replace('"k3f9a2"', "7"), "line 1: machine is not an id"],
    [LINE.replace(`,"tokens":${T}`, ""), "line 1: tokens is not an object"],
    [
      withTokens('{"input":1,"output":2,"cache_write":3}'),
      "line 1: tokens.cache_read is not a whole number of 0 or more",
    ],
    [withTokens(T.replace('"output":2', '"output":-2')), "line 1: tokens.output is not a whole number of 0 or more"],
    [withTokens(T.replace('"output":2', '"output":2.5')), "line 1: tokens.output is not a whole number of 0 or more"],
    [withTokens(T.replace('"output":2', '"output":"2"')), "line 1: tokens.output is not a whole number of 0 or more"],
    [
      withTokens(T.replace('"output":2', '"output":9007199254740993')),
      "line 1: tokens.output is not a whole number of 0 or more",
    ],
    [withTokens(T.replace("}", ',"reasoning":5}')), 'line 1: tokens has an unknown key "reasoning"'],
    [LINE.replace("}}", '},"models":[]}'), "line 1: models is not an object"],
    [LINE.replace("}}", `},"models":{"":${T}}}`), "line 1: a model has no name"],
    [
      LINE.replace("}}", '},"models":{"m":{"input":1,"output":2,"cache_write":3,"cache_read":-4}}}'),
      'line 1: models["m"].cache_read is not a whole number of 0 or more',
    ],
    [LINE.replace("}}", `},"models":{"a":${T},"b":${T}}}`), "line 1: tokens.input is not the sum of models"],
    [`${LINE}\n\n${LINE}`, "line 3: a second line for 2026-11-12, claude-code, k3f9a2; line 1 has it"],
  ]
  for (const [text, message] of cases) {
    assert.throws(() => parseHistory(text), { name: "HistoryError", message }, text)
  }
  assert.throws(
    () => parseHistory(`${LINE}\nnot json`),
    (error) => error instanceof HistoryError && error.line === 2,
  )
})

test("models: tokens is their sum, and a name such as __proto__ stays a name", () => {
  const text = LINE.replace("}}", `},"models":{"__proto__":${T}}}`)
  const [line] = parseHistory(text)
  assert.deepEqual(Object.keys(line.models ?? {}), ["__proto__"])
  assert.equal(formatHistory([line]), `${text}\n`)
})

test("isDate takes YYYY-MM-DD days that exist on the calendar", () => {
  for (const date of ["2026-11-13", "2028-02-29", "2000-02-29", "1999-12-31"]) assert.ok(isDate(date), date)
  for (const date of [
    "2026-02-29",
    "2100-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-11-31",
    "26-11-13",
    "2026-11-13 ",
  ]) {
    assert.ok(!isDate(date), date)
  }
})
