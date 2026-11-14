// The Claude Code collector, on transcripts written inline: today's format first, then one test
// for each row of the outline's table of shapes (research §1), named after its row. Every value is
// made up.

import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import { mock, test } from "node:test"
import { CHUNK_SIZE, claudeCode, readLines } from "../src/providers/claude-code.ts"
import type { Tokens } from "../src/providers/provider.ts"
import { type AssistantLine, assistant, scratch, transcripts } from "./helpers.ts"

const collect = (root: string, timeZone = "UTC") => claudeCode({ root }).collect({ timeZone })
const tokens = (input: number, output: number, cache_write: number, cache_read: number): Tokens => ({
  input,
  output,
  cache_write,
  cache_read,
})
const output = (n: number) => tokens(0, n, 0, 0)
const totals = async (root: string) => (await collect(root)).map((day) => day.tokens)

const SESSION_1 = "11111111-2222-4333-8444-555555555555"
const SESSION_2 = "66666666-7777-4888-9999-aaaaaaaaaaaa"

/** A transcript line of type "user": a prompt, or the result of a tool. */
const user = (content: unknown, edit: (line: Record<string, unknown>) => void = () => {}) => {
  const line: Record<string, unknown> = {
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: "/home/someone/work/app",
    sessionId: SESSION_1,
    version: "2.1.323",
    gitBranch: "main",
    type: "user",
    message: { role: "user", content },
    uuid: "00000000-0000-4000-8000-ffffffffffff",
    timestamp: "2026-11-12T17:59:00.000Z",
  }
  edit(line)
  return JSON.stringify(line)
}

const THINKING = { type: "thinking", thinking: "A made-up thought.", signature: "bWFkZS11cA==" }
const TEXT = { type: "text", text: "A made-up reply." }
const TOOL_USE = { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/home/someone/work/app/a.ts" } }

/** An edit for assistant(): the line holds this one content block, and this stop reason. */
const block =
  (content: Record<string, unknown>, stopReason: string | null) =>
  (line: AssistantLine): void => {
    line.message.content = [content]
    line.message.stop_reason = stopReason
  }

// ---------------------------------------------------------------------------------------------
// Today's format
// ---------------------------------------------------------------------------------------------

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
      // A subagent's progress, with its assistant message inside: the subagent's own file counts it.
      JSON.stringify({
        type: "progress",
        timestamp: "2026-11-12T18:00:00.000Z",
        data: {
          type: "agent_progress",
          message: JSON.parse(assistant({ id: "msg_8", requestId: "req_8", output: 9 })),
        },
      }),
      // Every field of an assistant line, under another type.
      JSON.stringify({ ...JSON.parse(assistant({ id: "msg_9", requestId: "req_9", output: 1000 })), type: "user" }),
      assistant({ id: "msg_1", requestId: "req_1", output: 42 }),
      "",
    ],
  })
  assert.deepEqual(await totals(root), [tokens(0, 42, 0, 0)])
})

test("no projects directory, or no transcripts in it: no days", async () => {
  assert.deepEqual(await collect(join(scratch(), "projects")), [])
  assert.deepEqual(await collect(scratch()), [])
  assert.deepEqual(await collect(transcripts({ "project/session.jsonl": [] })), [])
})

// ---------------------------------------------------------------------------------------------
// The outline's table: each transcript shape, and how it is counted
// ---------------------------------------------------------------------------------------------

test("one response on several lines with the same usage: counted once", async () => {
  // Today's session files: a line for each content block, each with the response's final usage,
  // and lines of other records between them.
  const first = { id: "msg_1", requestId: "req_1", input: 4, output: 428, cacheWrite: 1_782, cacheRead: 159_913 }
  const second = { id: "msg_2", requestId: "req_2", input: 1, output: 50, cacheRead: 161_695 }
  const root = transcripts({
    "-home-someone-work-app/session-1.jsonl": [
      user("A made-up prompt."),
      assistant(first, block(THINKING, "tool_use")),
      assistant(first, block(TEXT, "tool_use")),
      assistant(first, block(TOOL_USE, "tool_use")),
      user([{ type: "tool_result", tool_use_id: "toolu_1", content: "Made-up file contents." }]),
      assistant(second, block(THINKING, "end_turn")),
      assistant(second, block(TEXT, "end_turn")),
    ],
  })
  assert.deepEqual(await totals(root), [tokens(5, 478, 1_782, 321_608)])
})

test("a subagent file from before 2.1.307, where output_tokens grows line by line: counted once, with the largest", async () => {
  // 2.1.300 wrote the streaming placeholder on a response's first lines, and its final usage only
  // on the line with stop_reason set. A response with no such line keeps a placeholder.
  const before307 =
    (content: Record<string, unknown>, stopReason: string | null) =>
    (line: AssistantLine): void => {
      block(content, stopReason)(line)
      Object.assign(line, { version: "2.1.300", isSidechain: true, agentId: "a1b2c3d4" })
    }
  const finished = { id: "msg_1", requestId: "req_1", input: 3, cacheWrite: 2_000, cacheRead: 30_000 }
  const unfinished = { id: "msg_2", requestId: "req_2", input: 2, cacheRead: 32_000 }
  const root = transcripts({
    "-home-someone-work-app/session-1/subagents/agent-a1b2c3d4.jsonl": [
      user("A made-up task for the subagent.", (line) =>
        Object.assign(line, { isSidechain: true, agentId: "a1b2c3d4" }),
      ),
      assistant({ ...finished, output: 5 }, before307(THINKING, null)),
      assistant({ ...finished, output: 212 }, before307(TEXT, null)),
      assistant({ ...finished, output: 640 }, before307(TOOL_USE, "tool_use")),
      assistant({ ...unfinished, output: 5 }, before307(TEXT, null)),
      assistant({ ...unfinished, output: 9 }, before307(TOOL_USE, null)),
    ],
  })
  assert.deepEqual(await totals(root), [tokens(5, 649, 2_000, 62_000)])
})

test("a response copied into another session or subagent file by a resume or fork: counted once", async () => {
  // A resume copies the session's history into the new session's file, keeping message.id and
  // requestId and rewriting sessionId on some lines, and copies its subagent files along.
  const sidechain = (line: AssistantLine) => Object.assign(line, { isSidechain: true, agentId: "e5f6" })
  const a = { id: "msg_1", requestId: "req_1", sessionId: SESSION_1, output: 100, cacheRead: 10_000 }
  const b = { id: "msg_2", requestId: "req_2", sessionId: SESSION_1, output: 200, cacheRead: 20_000 }
  const c = { id: "msg_3", requestId: "req_3", sessionId: SESSION_2, output: 300, cacheRead: 30_000 }
  const agent = { id: "msg_4", requestId: "req_4", sessionId: SESSION_1, output: 400, cacheRead: 40_000 }
  const root = transcripts({
    [`app/${SESSION_1}.jsonl`]: [assistant(a), assistant(a), assistant(b)],
    [`app/${SESSION_1}/subagents/agent-e5f6.jsonl`]: [assistant(agent, sidechain)],
    [`app/${SESSION_2}.jsonl`]: [
      assistant({ ...a, sessionId: SESSION_2 }),
      assistant({ ...a, sessionId: SESSION_2 }),
      assistant(b),
      assistant(c),
    ],
    [`app/${SESSION_2}/subagents/agent-e5f6.jsonl`]: [assistant(agent, sidechain)],
  })
  assert.deepEqual(await totals(root), [tokens(0, 1_000, 0, 100_000)])
})

test("no requestId: counted once per message.id and sessionId", async () => {
  // Lines from before mid-2025 carry no requestId.
  const before = (line: AssistantLine) => Object.assign(line, { version: "1.0.8" })
  const root = transcripts({
    [`app/${SESSION_1}.jsonl`]: [
      assistant({ id: "msg_1", requestId: null, sessionId: SESSION_1, output: 10 }, before),
      assistant({ id: "msg_1", requestId: null, sessionId: SESSION_1, output: 10 }, before),
      assistant({ id: "msg_2", requestId: null, sessionId: SESSION_1, output: 20 }, before),
    ],
    [`app/${SESSION_2}.jsonl`]: [
      // A copy that kept its sessionId: the same response.
      assistant({ id: "msg_1", requestId: null, sessionId: SESSION_1, output: 10 }, before),
      // A copy whose sessionId was rewritten: nothing on the line ties it to the first, so it is
      // another response by this rule.
      assistant({ id: "msg_1", requestId: null, sessionId: SESSION_2, output: 10 }, before),
    ],
  })
  assert.deepEqual(await totals(root), [output(10 + 20 + 10)])
})

test("model <synthetic>: not counted at all", async () => {
  // Claude Code makes these messages up itself, for an API error or an interrupted turn, with no
  // request behind them.
  const says = (text: string) => block({ type: "text", text }, "stop_sequence")
  const root = transcripts({
    "app/session-1.jsonl": [
      // Alone on the 11th: that day gets no record, not even one of 0 tokens.
      assistant(
        {
          id: "00000000-aaaa-4bbb-8ccc-000000000001",
          requestId: null,
          timestamp: "2026-11-11T18:00:00Z",
          model: "<synthetic>",
        },
        says("API Error: a made-up overload"),
      ),
      assistant({ id: "msg_1", requestId: "req_1", output: 30, cacheRead: 3_000 }),
      // Usage on a <synthetic> line, which Claude Code does not write, counts nowhere either.
      assistant({ id: "msg_2", requestId: "req_2", model: "<synthetic>", output: 999 }, says("Made up.")),
    ],
  })
  assert.deepEqual(await collect(root), [
    {
      date: "2026-11-12",
      provider: "claude-code",
      tokens: tokens(0, 30, 0, 3_000),
      models: { "claude-opus-5-5": tokens(0, 30, 0, 3_000) },
    },
  ])
})

test("cache_creation_input_tokens of 0 beside a filled cache_creation object (before 2.1.152): the object's two fields, as cache write", async () => {
  const before152 = (fiveMinutes: number, oneHour: number) => (line: AssistantLine) => {
    line.version = "2.1.150"
    line.message.usage.cache_creation_input_tokens = 0
    line.message.usage.cache_creation = {
      ephemeral_5m_input_tokens: fiveMinutes,
      ephemeral_1h_input_tokens: oneHour,
    }
  }
  const written = { id: "msg_1", requestId: "req_1", input: 4, output: 428, cacheRead: 159_913 }
  const root = transcripts({
    "app/session-1.jsonl": [
      assistant(written, before152(82, 1_700)),
      assistant(written, before152(82, 1_700)),
      // No cache write at all.
      assistant({ id: "msg_2", requestId: "req_2", output: 10, cacheRead: 161_695 }, before152(0, 0)),
      // Today's lines: both say the same, and it counts once.
      assistant({ id: "msg_3", requestId: "req_3", output: 20, cacheWrite: 500, cacheRead: 161_700 }),
    ],
  })
  assert.deepEqual(await totals(root), [tokens(4, 458, 1_782 + 500, 483_308)])
})

test("a model name outside /^[A-Za-z0-9._:@-]{1,64}$/: under other", async () => {
  const names: [string | undefined, number][] = [
    ["claude-opus-5-5", 1],
    ["us.anthropic.claude-sonnet-5-5-v1:0", 2],
    ["claude-opus-5-5@20261101", 4],
    ["m".repeat(64), 8],
    // A cloud resource address, which holds an account number; another that holds a project.
    ["arn:aws:bedrock:us-west-2:123456789012:application-inference-profile/a1b2c3d4e5f6", 16],
    ["projects/made-up-project/locations/us-east5/publishers/anthropic/models/claude-opus-5-5", 32],
    ["claude opus", 64],
    ["m".repeat(65), 128],
    ["", 256],
    [undefined, 512],
  ]
  const root = transcripts({
    "app/session-1.jsonl": names.map(([model, n], i) =>
      assistant({ id: `msg_${i}`, requestId: `req_${i}`, output: n }, (line) => {
        if (model === undefined) delete line.message.model
        else line.message.model = model
      }),
    ),
  })
  const [day] = await collect(root)
  assert.deepEqual(day.models, {
    "claude-opus-5-5": output(1),
    "claude-opus-5-5@20261101": output(4),
    ["m".repeat(64)]: output(8),
    other: output(16 + 32 + 64 + 128 + 256 + 512),
    "us.anthropic.claude-sonnet-5-5-v1:0": output(2),
  })
  assert.deepEqual(day.tokens, output(1023))
})

test("lines on both sides of midnight: on the local date of the response's earliest line, in the configured zone", async () => {
  // msg_1's lines straddle midnight in Los Angeles: 23:59:59.900 on the 12th and 00:00:00.400 on
  // the 13th. Its later line is read first, and its earliest is a copy in a later file.
  const root = transcripts({
    "app/session-1.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-13T08:00:00.400Z", output: 428 }),
      assistant({ id: "msg_2", requestId: "req_2", timestamp: "2026-11-13T08:00:05.000Z", output: 7 }),
    ],
    "app/session-2.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-13T07:59:59.900Z", output: 5 }),
    ],
  })
  const outputs = async (zone: string) =>
    (await collect(root, zone)).map((day) => [day.date, day.tokens.output] as [string, number])
  assert.deepEqual(await outputs("America/Los_Angeles"), [
    ["2026-11-12", 428],
    ["2026-11-13", 7],
  ])
  assert.deepEqual(await outputs("UTC"), [["2026-11-13", 435]])
})

test("a half-written last line, or a line that is not JSON: skipped, with no error", async () => {
  const root = scratch("projects")
  mkdirSync(join(root, "app"))
  // Claude Code was writing this line when it was read, and had written its usage, then stopped
  // inside a character of three bytes. It holds both strings the quick test looks for, so it is
  // parsed, and fails.
  const writing = Buffer.from(
    assistant({ id: "msg_3", requestId: "req_3", output: 100 }, (line) => Object.assign(line, { slug: "made-up ✓" })),
  )
  const cut = writing.subarray(0, writing.lastIndexOf("✓") + 1)
  assert.ok(cut.includes('"usage"') && cut.includes('"assistant"'))
  writeFileSync(
    join(root, "app", "session-1.jsonl"),
    Buffer.concat([
      Buffer.from(
        [
          assistant({ id: "msg_1", requestId: "req_1", output: 1 }),
          "not JSON at all",
          // Holds both strings the quick test looks for, and is not JSON.
          '{"type":"assistant","message":{"usage":',
          "",
          assistant({ id: "msg_2", requestId: "req_2", output: 10 }),
          "",
        ].join("\n"),
      ),
      cut,
    ]),
  )
  // A whole last line with no "\n" counts like any other.
  writeFileSync(join(root, "app", "session-2.jsonl"), assistant({ id: "msg_4", requestId: "req_4", output: 1_000 }))
  assert.deepEqual(await totals(root), [output(1_011)])
})

test("CLAUDE_CONFIG_DIR set: from $CLAUDE_CONFIG_DIR/projects", async () => {
  // Read at each collect. An empty value counts as unset, and the value names one directory, so a
  // comma is part of its name. A root given to claudeCode() comes first.
  const home = scratch("home")
  transcripts(
    { "app/session.jsonl": [assistant({ id: "msg_1", requestId: "req_1", output: 1 })] },
    join(home, ".claude", "projects"),
  )
  const config = scratch("config")
  transcripts(
    { "app/session.jsonl": [assistant({ id: "msg_2", requestId: "req_2", output: 10 })] },
    join(config, "projects"),
  )
  const parent = scratch("configs")
  const comma = join(parent, "one,two")
  transcripts(
    { "app/session.jsonl": [assistant({ id: "msg_3", requestId: "req_3", output: 100 })] },
    join(comma, "projects"),
  )
  transcripts(
    { "app/session.jsonl": [assistant({ id: "msg_4", requestId: "req_4", output: 1_000 })] },
    join(parent, "one", "projects"),
  )

  const provider = claudeCode()
  const outputs = async (configDir: string | undefined, of = provider) => {
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, dir: process.env.CLAUDE_CONFIG_DIR }
    Object.assign(process.env, { HOME: home, USERPROFILE: home })
    if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = configDir
    try {
      assert.equal(homedir(), home) // so no collect here can reach this machine's own home
      return (await of.collect({ timeZone: "UTC" })).map((day) => day.tokens.output)
    } finally {
      Object.assign(process.env, { HOME: saved.HOME, USERPROFILE: saved.USERPROFILE })
      if (saved.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = saved.dir
    }
  }
  assert.deepEqual(await outputs(config), [10])
  assert.deepEqual(await outputs(undefined), [1])
  assert.deepEqual(await outputs(""), [1])
  assert.deepEqual(await outputs(comma), [100])
  assert.deepEqual(await outputs(config, claudeCode({ root: join(home, ".claude", "projects") })), [1])
})

// ---------------------------------------------------------------------------------------------
// Reading: as a stream, any line length, and files that go away
// ---------------------------------------------------------------------------------------------

test("readLines gives each line once and whole, at any read size", async () => {
  const dir = scratch("lines")
  const texts = [
    "",
    "\n",
    "\n\n",
    "a",
    "a\n",
    "a\nb",
    "ab\n\ncd\n",
    `${"x".repeat(5_000)}\ny\n${"z".repeat(3)}`,
    "naïve ✓ 日本 🎉\nnext ✓\n",
  ]
  for (const [i, text] of texts.entries()) {
    const file = join(dir, `${i}.jsonl`)
    writeFileSync(file, text)
    const expected = text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n")
    for (const size of [1, 2, 3, 4, 7, 64, 65_536]) {
      const lines: string[] = []
      await readLines(file, Buffer.alloc(size), (line) => lines.push(line.toString("utf8")))
      assert.deepEqual(lines, expected, `${JSON.stringify(text.slice(0, 20))} read ${size} bytes at a time`)
    }
  }
})

test("lines far longer than one read count like any other", async () => {
  const contents = "Made-up file contents. ".repeat(Math.ceil((2.5 * CHUNK_SIZE) / 23))
  const write = {
    type: "tool_use",
    id: "toolu_2",
    name: "Write",
    input: { file_path: "/home/someone/work/app/big.txt", content: contents },
  }
  const root = transcripts({
    "app/session-1.jsonl": [
      user([{ type: "tool_result", tool_use_id: "toolu_1", content: contents }]),
      assistant({ id: "msg_1", requestId: "req_1", output: 7 }, block(write, "tool_use")),
      assistant({ id: "msg_1", requestId: "req_1", output: 7 }, block(TEXT, "tool_use")),
      user([{ type: "tool_result", tool_use_id: "toolu_2", content: contents }]),
      assistant({ id: "msg_2", requestId: "req_2", output: 9 }),
    ],
  })
  assert.deepEqual(await totals(root), [output(16)])
})

test("the quick test that skips most lines unread lets through every line that can carry usage", async () => {
  // JSON with spaces, keys in another order, and "\r\n" line ends: none of which Claude Code writes.
  const spaced = JSON.stringify(JSON.parse(assistant({ id: "msg_1", requestId: "req_1", output: 3 })), null, 1)
  const { type, message, ...rest } = JSON.parse(assistant({ id: "msg_2", requestId: "req_2", output: 4 }))
  const root = scratch("projects")
  mkdirSync(join(root, "app"))
  writeFileSync(
    join(root, "app", "session-1.jsonl"),
    [spaced.replaceAll("\n", " "), JSON.stringify({ message, ...rest, type }), ""].join("\r\n"),
  )
  assert.deepEqual(await totals(root), [output(7)])
})

test("a file or directory that Claude Code's cleanup deletes while collect runs is skipped", async () => {
  // open and readdir from node:fs/promises, swapped for ones that delete their path first, as
  // the cleanup would between the walk listing it and the read.
  const fs = createRequire(import.meta.url)("node:fs/promises")
  const root = transcripts({
    "app/session-1.jsonl": [assistant({ id: "msg_1", requestId: "req_1", output: 1 })],
    "app/session-2.jsonl": [assistant({ id: "msg_2", requestId: "req_2", output: 10 })],
    "app/session-3/subagents/agent-a1.jsonl": [assistant({ id: "msg_3", requestId: "req_3", output: 100 })],
    "app/session-4.jsonl": [assistant({ id: "msg_4", requestId: "req_4", output: 1_000 })],
  })
  const gone = [join(root, "app", "session-2.jsonl"), join(root, "app", "session-3")]
  const deleting =
    <A extends unknown[], R>(real: (path: string, ...args: A) => R) =>
    (path: string, ...args: A): R => {
      if (gone.includes(String(path))) rmSync(path, { recursive: true, force: true })
      return real(path, ...args)
    }
  mock.method(fs, "open", deleting(fs.open))
  mock.method(fs, "readdir", deleting(fs.readdir))
  syncBuiltinESMExports()
  try {
    assert.deepEqual(await totals(root), [output(1_001)])

    // Any other error still stops the collect.
    mock.restoreAll()
    mock.method(fs, "open", async (path: string) => {
      throw Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: "EACCES" })
    })
    syncBuiltinESMExports()
    await assert.rejects(totals(root), { code: "EACCES" })
  } finally {
    mock.restoreAll()
    syncBuiltinESMExports()
  }
})
