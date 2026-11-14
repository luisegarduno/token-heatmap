// Only the listed fields leave the machine: the date, the provider, the machine id, the four
// counts, in total and by model, and model names that match the rule or read "other".
//
// Transcripts full of prompts, replies, file paths, project names and cloud resource addresses as
// model names are synced into a bare repository on disk, and set up into another: setup makes
// the first push, and sync each one after it. The test then reads what reached it, every object
// git holds there and not only the files at the tip, and fails on any other key or any of the
// planted strings. Every value is made up.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { readConfig } from "../src/config.ts"
import { claudeCode } from "../src/providers/claude-code.ts"
import { BOT, COMMIT_MESSAGE } from "../src/publish/git-readme.ts"
import { END, START } from "../src/readme.ts"
import { IMAGE_FILES, render } from "../src/render.ts"
import { setup } from "../src/setup.ts"
import { parseHistory } from "../src/store.ts"
import { sync } from "../src/sync.ts"
import {
  ASSETS,
  type AssistantLine,
  assistant,
  CONFIG,
  git,
  onGitHub,
  profileRepo,
  README,
  transcripts,
} from "./helpers.ts"

/** The rule for a published model name, written out here, not imported, so that the test checks the collector. */
const MODEL_RULE = /^[A-Za-z0-9._:@-]{1,64}$/
const COUNTS = ["input", "output", "cache_write", "cache_read"]
const HISTORY = "token-heatmap/history.jsonl"

/** Noon on November 13th in Los Angeles, the zone in CONFIG. */
const NOW = new Date("2026-11-13T20:00:00Z")
const TODAY = "2026-11-13"

/** Strings in the transcripts that must not leave the machine. */
const PLANTED = {
  "project name": "-home-planted-user-work-planted-project",
  "working directory": "/home/planted-user/work/planted-project",
  "file path": "/home/planted-user/work/planted-project/src/planted-secrets.ts",
  "git branch": "planted-feature-branch",
  "session id": "5e55105e-0000-4000-8000-5e55105e0001",
  "forked session id": "5e55105e-0000-4000-8000-5e55105e0002",
  "agent id": "a9e47d1a7ed0",
  "message id": "msg_planted0message0id",
  "request id": "req_planted0request0id",
  "tool use id": "toolu_planted0tool0use",
  prompt: "Planted prompt: rotate the made-up staging password",
  "e-mail address": "planted.user@example.com",
  reply: "Planted reply: the made-up password is rotated",
  thinking: "Planted thinking about the made-up password",
  "file contents": "PLANTED_MADE_UP_TOKEN=made-up-0000",
  "session title": "Planted session title",
  "hook output": "Planted hook output",
  "Claude Code version": "2.1.999-planted",
  "time of day": "18:07:13",
  "account number": "987654321098",
  "AWS resource address": "arn:aws:bedrock:us-west-2:987654321098:application-inference-profile/planted0profile",
  "Google Cloud project": "planted-gcp-project",
  "Google Cloud resource address":
    "projects/planted-gcp-project/locations/us-east5/publishers/anthropic/models/claude-opus-5-5",
  "markup as a model name": '<img src="planted.png" onerror="alert(1)">',
  "a model name too long to publish": `planted-${"m".repeat(60)}`,
  "Claude Code's own model name": "<synthetic>",
}
const P = PLANTED

const TIME = `2026-11-12T${P["time of day"]}`

/** Today's assistant line, with every value that is not a count or a model name planted. */
const planted =
  (o: { session?: string; content?: Record<string, unknown>; sidechain?: boolean } = {}) =>
  (line: AssistantLine): void => {
    Object.assign(line, {
      cwd: P["working directory"],
      gitBranch: P["git branch"],
      version: P["Claude Code version"],
      sessionId: o.session ?? P["session id"],
      ...(o.sidechain ? { isSidechain: true, agentId: P["agent id"] } : {}),
    })
    line.message.content = [o.content ?? { type: "text", text: P.reply }]
  }

/** Any other record, with the same planted values. */
const other = (record: Record<string, unknown>) =>
  JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: P["working directory"],
    sessionId: P["session id"],
    version: P["Claude Code version"],
    gitBranch: P["git branch"],
    timestamp: `${TIME}.100Z`,
    ...record,
  })

/** A response by a model that is published as it is, written on three lines. */
const opus = {
  id: P["message id"],
  requestId: P["request id"],
  timestamp: `${TIME}.512Z`,
  input: 3,
  output: 211,
  cacheWrite: 1_204,
  cacheRead: 52_118,
}
/** Responses whose model names must count under "other". */
const unpublishable = (model: string, i: number, output: number, cacheRead = 0) =>
  assistant(
    { id: `msg_planted${i}`, requestId: `req_planted${i}`, timestamp: `${TIME}.6${i}0Z`, model, output, cacheRead },
    planted(),
  )

function plantedTranscripts(): string {
  const session = `${P["project name"]}/${P["session id"]}`
  return transcripts({
    [`${session}.jsonl`]: [
      other({ type: "summary", summary: P["session title"], leafUuid: "00000000-0000-4000-8000-000000000001" }),
      other({ type: "user", message: { role: "user", content: `${P.prompt}, and write to ${P["e-mail address"]}` } }),
      assistant(opus, planted({ content: { type: "thinking", thinking: P.thinking, signature: "bWFkZS11cA==" } })),
      assistant(opus, planted({ content: { type: "text", text: P.reply } })),
      assistant(
        opus,
        planted({
          content: { type: "tool_use", id: P["tool use id"], name: "Read", input: { file_path: P["file path"] } },
        }),
      ),
      other({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: P["tool use id"], content: P["file contents"] }],
        },
        toolUseResult: { type: "text", file: { filePath: P["file path"], content: P["file contents"] } },
      }),
      other({ type: "system", subtype: "stop_hook_summary", content: P["hook output"], level: "info" }),
      other({
        type: "file-history-snapshot",
        snapshot: { trackedFileBackups: { [P["file path"]]: { backupFileName: "made-up@v1", version: 1 } } },
      }),
      unpublishable(P["AWS resource address"], 1, 17, 4_001),
      unpublishable(P["Google Cloud resource address"], 2, 19, 4_003),
      unpublishable(P["markup as a model name"], 3, 23),
      unpublishable(P["a model name too long to publish"], 4, 29),
      assistant(
        {
          id: "msg_planted5",
          requestId: "req_planted5",
          model: "us.anthropic.claude-sonnet-5-5-v1:0",
          output: 31,
          cacheRead: 5_005,
        },
        planted(),
      ),
      assistant({ id: "msg_planted6", requestId: null, model: P["Claude Code's own model name"] }, planted()),
      other({
        type: "attachment",
        attachment: { type: "queued_command", prompt: P.prompt, usage: { totalTokens: 9, toolUses: 1, durationMs: 9 } },
      }),
      other({
        type: "cost-state",
        modelUsage: { [P["AWS resource address"]]: { inputTokens: 1, outputTokens: 17, costUSD: 0.01 } },
      }),
      // Claude Code was writing this line, past its usage, when it was read.
      assistant({ id: "msg_planted7", requestId: "req_planted7", output: 1 }, planted()).slice(0, -40),
    ],
    [`${session}/subagents/agent-${P["agent id"]}.jsonl`]: [
      other({ type: "user", isSidechain: true, agentId: P["agent id"], message: { role: "user", content: P.prompt } }),
      assistant(
        { id: "msg_planted8", requestId: "req_planted8", timestamp: `${TIME}.900Z`, output: 37, cacheRead: 6_007 },
        planted({ sidechain: true }),
      ),
    ],
    // A fork: the history copied under another session id, then nothing new.
    [`${P["project name"]}/${P["forked session id"]}.jsonl`]: [
      assistant(opus, planted({ session: P["forked session id"] })),
      unpublishable(P["AWS resource address"], 1, 17, 4_001),
    ],
  })
}

/** Every file under `dir`, at any depth. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  )

/** `text` as a regular expression that matches it and nothing else. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A planted value as it reads as it is, inside a JSON string, and in HTML. */
const forms = (value: string) => [
  ...new Set([
    value,
    JSON.stringify(value).slice(1, -1),
    value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  ]),
]

/** The owner's README for setup: no markers yet, so setup adds them at its end. */
const OWN = "# Hi, I'm a made-up user\n\nSome text of my own.\n"

for (const via of ["sync", "setup"] as const) {
  for (const models of [true, false]) {
    test(`${via}: only the listed fields reach the profile repository, and none of the planted strings ("models": ${models})`, async () => {
      const root = plantedTranscripts()
      const written = filesUnder(root)
        .map((file) => `${file}\n${readFileSync(file, "utf8")}`)
        .join("\n")
      for (const [what, value] of Object.entries(PLANTED)) {
        assert.ok(
          forms(value).some((form) => written.includes(form)),
          `the ${what} is in the transcripts`,
        )
      }

      const providers = [claudeCode({ root })]
      const profile = profileRepo(via === "sync" ? { config: { models } } : { readme: OWN, config: null })
      if (via === "sync") {
        assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
      } else {
        onGitHub(profile.remote)
        const { done } = await setup({
          dataDir: profile.dataDir,
          repository: CONFIG.repository,
          timeZone: CONFIG.timeZone,
          models,
          yes: true,
          providers,
          now: NOW,
          assets: ASSETS,
        })
        assert.equal(done, "pushed")
      }
      // setup makes a new machine id; profileRepo() writes CONFIG's for sync.
      const machine = readConfig(profile.dataDir).machine
      assert.equal(machine === CONFIG.machine, via === "sync")

      // history.jsonl: the listed keys, and nothing else.
      const history = profile.file(HISTORY) ?? ""
      const counts = (value: unknown, where: string) => {
        assert.deepEqual(Object.keys(value as object), COUNTS, where)
        for (const count of Object.values(value as object)) assert.ok(Number.isSafeInteger(count) && count >= 0, where)
      }
      for (const text of history.trimEnd().split("\n")) {
        const line = JSON.parse(text)
        assert.deepEqual(Object.keys(line), ["date", "provider", "machine", "tokens", ...(models ? ["models"] : [])])
        assert.match(line.date, /^\d{4}-\d{2}-\d{2}$/)
        assert.equal(line.provider, "claude-code")
        assert.equal(line.machine, machine)
        counts(line.tokens, "tokens")
        for (const [name, value] of Object.entries(line.models ?? {})) {
          assert.ok(MODEL_RULE.test(name) || name === "other", `model name ${JSON.stringify(name)}`)
          counts(value, `models[${JSON.stringify(name)}]`)
        }
      }
      // Each response once, and the names that are not published under "other".
      const day = { input: 3, output: 367, cache_write: 1_204, cache_read: 71_134 }
      assert.deepEqual(parseHistory(history), [
        {
          date: "2026-11-12",
          provider: "claude-code",
          machine,
          tokens: day,
          ...(models
            ? {
                models: {
                  "claude-opus-5-5": { input: 3, output: 211 + 37, cache_write: 1_204, cache_read: 52_118 + 6_007 },
                  other: { input: 0, output: 17 + 19 + 23 + 29, cache_write: 0, cache_read: 4_001 + 4_003 },
                  "us.anthropic.claude-sonnet-5-5-v1:0": { input: 0, output: 31, cache_write: 0, cache_read: 5_005 },
                },
              }
            : {}),
        },
      ])

      // README.md: the owner's own text, and a block drawn from history.jsonl alone, between the
      // markers the owner put in, or that setup added at the end.
      const readme = profile.file("README.md") ?? ""
      const block = `${START}\n${render(parseHistory(history), TODAY)}\n${END}`
      assert.equal(readme, via === "sync" ? README.replace(`${START}\n${END}`, block) : `${OWN}\n${block}\n`)

      // The images: only setup's commit has them, each as the plugin ships it. sync never touches them.
      const images = via === "sync" ? [] : IMAGE_FILES
      for (const name of images) {
        assert.equal(profile.file(`token-heatmap/${name}`), readFileSync(join(ASSETS, name), "utf8"), name)
      }

      // The commit: sync's touches the two files, and setup's the images as well. It is by the bot,
      // with the fixed message and no other header. Its date, with this machine's UTC offset, is git's own.
      const [commit, ...older] = profile.log()
      assert.equal(older.length, 1)
      const files = ["README.md", ...[HISTORY, ...images.map((name) => `token-heatmap/${name}`)].sort()]
      assert.deepEqual(commit.files, files)
      const raw = git(profile.remote, ["cat-file", "commit", commit.sha])
      const bot = literally(`${BOT.name} <${BOT.email}>`)
      assert.match(
        raw,
        new RegExp(
          `^tree [0-9a-f]{40}\\nparent [0-9a-f]{40}\\nauthor ${bot} \\d+ [+-]\\d{4}\\ncommitter ${bot} \\d+ [+-]\\d{4}\\n\\n${literally(COMMIT_MESSAGE)}\\n$`,
        ),
      )
      assert.deepEqual(git(profile.remote, ["ls-tree", "-r", "--name-only", "main"]).trimEnd().split("\n"), files)

      // Not one planted string, in the three files or anywhere in the repository: every object and every ref.
      const repository =
        git(profile.remote, ["cat-file", "--batch-all-objects", "--batch"]) +
        git(profile.remote, ["for-each-ref", "--format=%(refname)"])
      const places = { "history.jsonl": history, "README.md": readme, "the commit": raw, "the repository": repository }
      for (const [place, text] of Object.entries(places)) {
        for (const [what, value] of Object.entries(PLANTED)) {
          for (const form of forms(value)) assert.ok(!text.includes(form), `the ${what} reached ${place}: ${form}`)
        }
      }
    })
  }
}
