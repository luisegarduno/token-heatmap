// state.json and sync.lock: the hourly limit, the lock, the result runSync writes down, and what
// status prints. The clock is passed in, so no test waits. runSync's cases push to a bare
// repository that profileRepo() makes in a temporary directory.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { claudeCode } from "../src/providers/claude-code.ts"
import {
  isStale,
  lockPath,
  nextAllowed,
  readLock,
  readState,
  STALE_LOCK,
  type State,
  statePath,
  statusText,
  takeLock,
  withResult,
  withSkip,
  writeState,
} from "../src/state.ts"
import { detachedEnv, runSync } from "../src/sync.ts"
import { assistant, profileRepo, scratch, transcripts } from "./helpers.ts"

/** Noon on November 13th in Los Angeles, the zone in CONFIG. */
const NOON = new Date("2026-11-13T20:00:00Z")
const MINUTE = 60_000
const later = (minutes: number, from = NOON) => new Date(from.getTime() + minutes * MINUTE)

/** A pid that no process has now. */
function endedPid(): number {
  const { pid } = spawnSync(process.execPath, ["-e", ""])
  assert.ok(pid)
  return pid
}

/** A provider that reads one made-up response on November 12th. */
const providers = () => [
  claudeCode({
    root: transcripts({
      "app/session-1.jsonl": [assistant({ id: "msg_1", requestId: "req_1", output: 412, cacheRead: 96_000_000 })],
    }),
  }),
]

// ---------------------------------------------------------------------------------------------
// The limit
// ---------------------------------------------------------------------------------------------

test("the limit: a hook's sync waits 60 minutes after the last sync, and SessionEnd's 5", () => {
  const state: State = { lastSync: NOON.toISOString() }
  for (const trigger of ["SessionStart", "Stop"] as const) {
    assert.deepEqual(nextAllowed(state, trigger, later(1)), later(60))
    assert.deepEqual(nextAllowed(state, trigger, later(59.99)), later(60))
    assert.equal(nextAllowed(state, trigger, later(60)), undefined)
  }
  assert.deepEqual(nextAllowed(state, "SessionEnd", later(4)), later(5))
  assert.equal(nextAllowed(state, "SessionEnd", later(5)), undefined)
  assert.equal(nextAllowed(state, "SessionEnd", later(30)), undefined)
})

test("the limit: no state.json, one that cannot be read, and a last sync after now hold nothing up", () => {
  const dir = scratch("data")
  assert.deepEqual(readState(dir), {})
  writeFileSync(statePath(dir), "{ half a file")
  assert.deepEqual(readState(dir), {})
  writeFileSync(statePath(dir), "[1, 2]")
  assert.deepEqual(readState(dir), {})
  assert.equal(nextAllowed({}, "Stop", NOON), undefined)
  assert.equal(nextAllowed({ lastSync: "not a time" }, "Stop", NOON), undefined)
  assert.equal(nextAllowed({ lastSync: later(10).toISOString() }, "Stop", NOON), undefined) // the clock went back
})

test("state: a skip is counted; a result starts the count again, and an error keeps the last push", () => {
  let state = withResult({}, { now: NOON, trigger: "Stop", result: "pushed" })
  assert.deepEqual(state, {
    lastSync: NOON.toISOString(),
    trigger: "Stop",
    result: "pushed",
    lastPush: NOON.toISOString(),
  })
  state = withSkip(withSkip(state, "Stop", later(10)), "SessionStart", later(20))
  assert.deepEqual(state.skipped, { count: 2, time: later(20).toISOString(), trigger: "SessionStart" })

  state = withResult(state, { now: later(61), trigger: null, error: "git push failed: no route" })
  assert.deepEqual(state, {
    lastSync: later(61).toISOString(),
    trigger: null,
    result: "error",
    lastPush: NOON.toISOString(),
    lastError: { time: later(61).toISOString(), trigger: null, message: "git push failed: no route" },
  })
  state = withResult(state, { now: later(130), trigger: "SessionEnd", result: "unchanged" })
  assert.equal(state.result, "unchanged")
  assert.equal(state.lastPush, NOON.toISOString())
  assert.equal(state.lastError?.message, "git push failed: no route") // kept after a later success

  const dir = scratch("data")
  writeState(dir, state)
  assert.deepEqual(readState(dir), state)
})

// ---------------------------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------------------------

test("the lock: one sync holds it at a time, and release lets the next take it", () => {
  const dir = scratch("data")
  const first = takeLock(dir, NOON)
  assert.ok(first)
  assert.equal(readLock(dir)?.pid, process.pid)
  assert.equal(takeLock(dir, later(1)), undefined)
  first.release()
  assert.equal(existsSync(lockPath(dir)), false)
  const second = takeLock(dir, later(2))
  assert.ok(second)
  second.release()
})

test("the lock: a stale one is taken over, when its process ended or it is older than 15 minutes", () => {
  const dir = scratch("data")
  const write = (pid: number, time: Date) =>
    writeFileSync(lockPath(dir), JSON.stringify({ pid, time: time.toISOString(), token: "theirs" }))

  write(endedPid(), NOON)
  const afterEnd = takeLock(dir, later(1))
  assert.ok(afterEnd, "the process that held it has ended")
  afterEnd.release()

  write(process.pid, NOON) // a process that still runs: this one
  assert.equal(takeLock(dir, later(STALE_LOCK / MINUTE)), undefined)
  assert.equal(isStale(readLock(dir) ?? assert.fail(), later(14)), false)
  const old = takeLock(dir, later(STALE_LOCK / MINUTE + 1))
  assert.ok(old, "older than 15 minutes")
  old.release()

  write(process.pid, later(10)) // dated after now: a clock set back
  const ahead = takeLock(dir, NOON)
  assert.ok(ahead)
  ahead.release()
})

test("the lock: one that cannot be read is held for 10 seconds, as it may be being written", () => {
  const dir = scratch("data")
  writeFileSync(lockPath(dir), "")
  assert.equal(takeLock(dir, new Date()), undefined)
  // Written in this very millisecond: the mtime's fraction puts it just after a whole-millisecond now.
  assert.equal(takeLock(dir, new Date(Math.floor(statSync(lockPath(dir)).mtimeMs))), undefined)
  const lock = takeLock(dir, new Date(Date.now() + 11_000))
  assert.ok(lock)
  lock.release()
})

test("the lock: release removes only its own lock, not one taken over since", () => {
  const dir = scratch("data")
  const mine = takeLock(dir, NOON) ?? assert.fail()
  const theirs = takeLock(dir, later(STALE_LOCK / MINUTE + 1)) ?? assert.fail() // took mine over as stale
  mine.release()
  assert.equal(existsSync(lockPath(dir)), true)
  theirs.release()
  assert.equal(existsSync(lockPath(dir)), false)
})

// ---------------------------------------------------------------------------------------------
// runSync
// ---------------------------------------------------------------------------------------------

test("runSync: a hook's sync, then the hooks within the hour are skipped and counted, then SessionEnd after 5 minutes", async () => {
  const profile = profileRepo()
  const run = (trigger: "SessionStart" | "Stop" | "SessionEnd" | undefined, now: Date) =>
    runSync({ dataDir: profile.dataDir, providers: providers(), now, trigger })

  assert.equal(await run("SessionStart", NOON), "pushed")
  assert.equal(profile.log().length, 2)
  assert.deepEqual(readState(profile.dataDir), {
    lastSync: NOON.toISOString(),
    trigger: "SessionStart",
    result: "pushed",
    lastPush: NOON.toISOString(),
  })

  assert.equal(await run("Stop", later(10)), "limited")
  assert.equal(await run("Stop", later(20)), "limited")
  assert.equal(await run("SessionEnd", later(4)), "limited")
  assert.deepEqual(readState(profile.dataDir).skipped, {
    count: 3,
    time: later(4).toISOString(),
    trigger: "SessionEnd",
  })
  assert.equal(profile.log().length, 2, "no commit while the limit holds")

  assert.equal(await run("SessionEnd", later(30)), "unchanged")
  assert.deepEqual(readState(profile.dataDir), {
    lastSync: later(30).toISOString(),
    trigger: "SessionEnd",
    result: "unchanged",
    lastPush: NOON.toISOString(),
  })
  assert.equal(await run(undefined, later(31)), "unchanged", "a sync by hand skips the limit")
  assert.equal(readState(profile.dataDir).trigger, null)
  assert.equal(await run("Stop", later(31 + 60)), "unchanged")
  assert.equal(existsSync(lockPath(profile.dataDir)), false)
})

test("runSync: while another sync holds the lock, it stops and writes nothing", async () => {
  const profile = profileRepo()
  const held = takeLock(profile.dataDir, NOON) ?? assert.fail()
  assert.equal(
    await runSync({ dataDir: profile.dataDir, providers: providers(), now: later(1), trigger: "Stop" }),
    "locked",
  )
  assert.equal(await runSync({ dataDir: profile.dataDir, providers: providers(), now: later(1) }), "locked")
  assert.equal(existsSync(statePath(profile.dataDir)), false)
  assert.equal(profile.log().length, 1)
  held.release()
})

test("runSync: an error is written to state.json, then thrown, and the lock is released", async () => {
  const profile = profileRepo({ readme: "# No markers here\n" })
  await assert.rejects(
    runSync({ dataDir: profile.dataDir, providers: providers(), now: NOON, trigger: "Stop" }),
    /README\.md has no/,
  )
  const state = readState(profile.dataDir)
  assert.equal(state.result, "error")
  assert.equal(state.lastSync, NOON.toISOString())
  assert.equal(state.lastPush, undefined)
  assert.equal(state.lastError?.trigger, "Stop")
  assert.match(state.lastError?.message ?? "", /^README\.md has no "<!-- token-heatmap:start -->" line/)
  assert.equal(existsSync(lockPath(profile.dataDir)), false)
  // The hour holds after a failed sync too, so a broken setup does not retry at every reply.
  assert.equal(
    await runSync({ dataDir: profile.dataDir, providers: providers(), now: later(5), trigger: "Stop" }),
    "limited",
  )
})

test("runSync: a push that git cannot sign in to records the fix", async () => {
  const profile = profileRepo()
  // An address that leads nowhere, as in Phase 6's manual check.
  spawnSync("git", ["-C", profile.clone, "remote", "set-url", "--push", "origin", join(scratch("gone"), "nowhere.git")])
  await assert.rejects(runSync({ dataDir: profile.dataDir, providers: providers(), now: NOON, trigger: "Stop" }))
  const message = readState(profile.dataDir).lastError?.message ?? ""
  // git says this over three lines, ending in a period: kept on one line, with one period.
  assert.match(
    message,
    /^git push failed: fatal: '[^']+' does not appear to be a git repository fatal: Could not read /,
  )
  assert.match(
    message,
    /and the repository exists\. If git could not sign in, run `gh auth setup-git`; the next sync tries again$/,
  )
  assert.doesNotMatch(message, /\n|\.\./)
  assert.equal(profile.log().length, 1)
})

test("detachedEnv: no terminal prompt, no Git Credential Manager window, and an askpass that fails", () => {
  const env = detachedEnv({ PATH: process.env.PATH, GIT_ASKPASS: "/usr/bin/ksshaskpass", KEEP: "me" })
  assert.equal(env.KEEP, "me")
  assert.equal(env.GIT_TERMINAL_PROMPT, "0")
  assert.equal(env.GCM_INTERACTIVE, "never")
  assert.equal(env.SSH_ASKPASS_REQUIRE, "never")
  assert.equal(env.SSH_ASKPASS, env.GIT_ASKPASS)
  assert.notEqual(env.GIT_ASKPASS, "/usr/bin/ksshaskpass")
  const ask = spawnSync(env.GIT_ASKPASS ?? assert.fail(), ["Password for 'https://github.com': "], { env })
  assert.ok(ask.error !== undefined || ask.status !== 0, "the askpass fails")
  assert.equal(ask.stdout?.length ?? 0, 0)
})

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

test("status: not set up, and a config.json that cannot be read", () => {
  const dir = scratch("data")
  assert.equal(
    statusText(dir, NOON),
    "token-heatmap is not set up on this machine: run /token-heatmap:setup in Claude Code.\n",
  )
  writeFileSync(join(dir, "config.json"), "{}")
  assert.equal(
    statusText(dir, NOON),
    `token-heatmap cannot sync: ${join(dir, "config.json")}: repository is not a GitHub repository written USER/USER\n`,
  )
})

test("status: before the first sync, then after a push, skips, an error and while a sync runs", () => {
  const profile = profileRepo()
  const dir = profile.dataDir
  const profileLine =
    "Profile:    github.com/made-up-user/made-up-user, machine k3f9a2, days in America/Los_Angeles, model names published"
  assert.equal(
    statusText(dir, NOON),
    [
      profileLine,
      "Last sync:  none yet. The next SessionStart, Stop or SessionEnd hook runs one",
      "Last push:  none yet",
      "Last error: none",
      "",
    ].join("\n"),
  )

  let state = withResult({}, { now: NOON, trigger: "Stop", result: "pushed" })
  state = withSkip(withSkip(state, "Stop", later(3)), "Stop", later(12))
  writeState(dir, state)
  assert.equal(
    statusText(dir, later(15)),
    [
      profileLine,
      "Last sync:  2026-11-13 12:00 (15 minutes ago), on Stop: pushed one commit",
      "Last push:  2026-11-13 12:00 (15 minutes ago)",
      "Skipped:    2 hooks since the last sync, as it was too recent; the last 2026-11-13 12:12 (3 minutes ago), on Stop",
      "Last error: none",
      "Next sync:  at the first hook from 2026-11-13 13:00, or at the next SessionEnd",
      "",
    ].join("\n"),
  )
  assert.match(
    statusText(dir, later(4)),
    /\nNext sync: {2}at the first hook from 2026-11-13 13:00, or SessionEnd from 2026-11-13 12:05\n/,
  )

  writeState(dir, withResult(state, { now: later(180), trigger: null, error: "git push failed: no route" }))
  const lock = takeLock(dir, later(181)) ?? assert.fail()
  assert.equal(
    statusText(dir, later(182)),
    [
      profileLine,
      "Last sync:  2026-11-13 15:00 (2 minutes ago), run by hand: failed, see Last error",
      "Last push:  2026-11-13 12:00 (3 hours ago)",
      "Last error: 2026-11-13 15:00 (2 minutes ago), run by hand: git push failed: no route",
      "Running:    a sync since 2026-11-13 15:01 (1 minute ago)",
      "Next sync:  at the first hook from 2026-11-13 16:00, or SessionEnd from 2026-11-13 15:05",
      "",
    ].join("\n"),
  )
  lock.release()
  assert.match(
    statusText(dir, later(60 * 24 * 3)),
    /\nLast push: {2}2026-11-13 12:00 \(3 days ago\)\nLast error: [^\n]+\nNext sync: {2}at the next hook\n$/,
  )
  assert.equal(readFileSync(join(dir, "config.json"), "utf8").includes("k3f9a2"), true)
})
