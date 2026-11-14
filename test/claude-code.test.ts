// The Claude Code collector on transcripts in today's format, written inline. Every value is
// made up.

import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"
import { claudeCode } from "../src/providers/claude-code.ts"
import type { Tokens } from "../src/providers/provider.ts"
import { assistant, scratch, transcripts } from "./helpers.ts"

const collect = (root: string, timeZone = "UTC") => claudeCode({ root }).collect({ timeZone })
const tokens = (input: number, output: number, cache_write: number, cache_read: number): Tokens => ({
  input,
  output,
  cache_write,
  cache_read,
})

test("its id is claude-code", () => {
  assert.equal(claudeCode().id, "claude-code")
})

test("one response on three lines counts once, with its largest usage", async () => {
  const root = transcripts({
    "project/session.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", output: 5 }),
      assistant({ id: "msg_1", requestId: "req_1", output: 40 }),
      assistant({ id: "msg_1", requestId: "req_1", output: 428 }),
    ],
  })
  const [day] = await collect(root)
  assert.equal(day.tokens.output, 428)
})

test("the largest usage is the largest of the four types added, kept whole", async () => {
  const root = transcripts({
    "project/session.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", input: 9, output: 1, cacheRead: 100 }),
      assistant({ id: "msg_1", requestId: "req_1", input: 1, output: 2, cacheRead: 200 }),
      assistant({ id: "msg_1", requestId: "req_1", input: 50, output: 50, cacheRead: 50 }),
    ],
  })
  const [day] = await collect(root)
  assert.deepEqual(day.tokens, tokens(1, 2, 0, 200))
})

test("the four types are input, output, cache creation and cache read tokens", async () => {
  // assistant() also writes the cache_creation object, which repeats cache_creation_input_tokens
  // and is not added a second time.
  const root = transcripts({
    "project/session.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", input: 4, output: 428, cacheWrite: 1782, cacheRead: 159913 }),
    ],
  })
  assert.deepEqual(await collect(root), [
    {
      date: "2026-11-12",
      provider: "claude-code",
      tokens: tokens(4, 428, 1782, 159913),
      models: { "claude-opus-5-5": tokens(4, 428, 1782, 159913) },
    },
  ])
})

test("responses add up by day and by model, and tokens is the sum of models", async () => {
  const root = transcripts({
    "project/session-1.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-12T01:00:00Z", output: 10, cacheRead: 1000 }),
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-12T01:00:01Z", output: 10, cacheRead: 1000 }),
      assistant({ id: "msg_2", requestId: "req_2", timestamp: "2026-11-12T02:00:00Z", output: 20, cacheRead: 2000 }),
      assistant({
        id: "msg_3",
        requestId: "req_3",
        timestamp: "2026-11-12T03:00:00Z",
        model: "claude-sonnet-5-5",
        input: 3,
        cacheWrite: 300,
      }),
    ],
    "project/session-2.jsonl": [
      assistant({ id: "msg_4", requestId: "req_4", timestamp: "2026-11-10T12:00:00Z", output: 7 }),
      assistant({ id: "msg_5", requestId: "req_5", timestamp: "2026-11-12T23:59:59Z", input: 1, output: 1 }),
    ],
  })
  assert.deepEqual(await collect(root), [
    {
      date: "2026-11-10",
      provider: "claude-code",
      tokens: tokens(0, 7, 0, 0),
      models: { "claude-opus-5-5": tokens(0, 7, 0, 0) },
    },
    {
      date: "2026-11-12",
      provider: "claude-code",
      tokens: tokens(4, 31, 300, 3000),
      models: { "claude-opus-5-5": tokens(1, 31, 0, 3000), "claude-sonnet-5-5": tokens(3, 0, 300, 0) },
    },
  ])
})

test("a response belongs to its day in the configured time zone", async () => {
  const root = transcripts({
    "project/session.jsonl": [
      // 23:30 on the 12th in Los Angeles; the 13th in UTC and in Tokyo
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-13T07:30:00.000Z", output: 1 }),
      // 08:30 on the 13th in Los Angeles and in UTC; 01:30 on the 14th in Tokyo
      assistant({ id: "msg_2", requestId: "req_2", timestamp: "2026-11-13T16:30:00.000Z", output: 2 }),
    ],
  })
  const outputs = async (zone: string) =>
    (await collect(root, zone)).map((day) => [day.date, day.tokens.output] as [string, number])
  assert.deepEqual(await outputs("UTC"), [["2026-11-13", 3]])
  assert.deepEqual(await outputs("America/Los_Angeles"), [
    ["2026-11-12", 1],
    ["2026-11-13", 2],
  ])
  assert.deepEqual(await outputs("Asia/Tokyo"), [
    ["2026-11-13", 1],
    ["2026-11-14", 2],
  ])
})

test("session files and subagent files are read, in every project", async () => {
  const root = transcripts({
    "-home-someone-work-app/session-1.jsonl": [assistant({ id: "msg_1", requestId: "req_1", output: 1 })],
    "-home-someone-work-app/session-1/subagents/agent-a1.jsonl": [
      assistant({ id: "msg_2", requestId: "req_2", output: 10 }),
    ],
    "-home-someone-work-site/session-2.jsonl": [assistant({ id: "msg_3", requestId: "req_3", output: 100 })],
    "-home-someone-work-site/session-2/tool-results/result.txt": ["not a transcript"],
  })
  const [day] = await collect(root)
  assert.equal(day.tokens.output, 111)
})

test("only assistant lines count: other records, and usage elsewhere, count nowhere", async () => {
  const root = transcripts({
    "project/session.jsonl": [
      JSON.stringify({ type: "summary", summary: "A made-up title", leafUuid: "x" }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-12T18:00:00.000Z",
        message: { role: "user", content: "A made-up prompt" },
        // The Agent tool's result repeats its subagent's last usage.
        toolUseResult: { totalTokens: 5000, usage: { input_tokens: 1000, output_tokens: 4000 } },
      }),
      JSON.stringify({
        type: "attachment",
        timestamp: "2026-11-12T18:00:00.000Z",
        attachment: { type: "queued_command", usage: { totalTokens: 7000, toolUses: 3, durationMs: 100 } },
      }),
      JSON.stringify({ type: "cost-state", sessionId: "s", modelUsage: { "claude-opus-5-5": { inputTokens: 9 } } }),
      // Every field of an assistant line, under another type.
      JSON.stringify({ ...JSON.parse(assistant({ id: "msg_9", requestId: "req_9", output: 1000 })), type: "user" }),
      assistant({ id: "msg_1", requestId: "req_1", output: 42 }),
      "",
    ],
  })
  assert.deepEqual(
    (await collect(root)).map((day) => day.tokens),
    [tokens(0, 42, 0, 0)],
  )
})

test("no projects directory, or no transcripts in it: no days", async () => {
  assert.deepEqual(await collect(join(scratch(), "projects")), [])
  assert.deepEqual(await collect(scratch()), [])
  assert.deepEqual(await collect(transcripts({ "project/session.jsonl": [] })), [])
})
