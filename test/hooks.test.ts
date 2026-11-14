// What a hook runs: `token-heatmap sync --trigger EVENT`. It returns at once and leaves the sync to
// a detached copy of itself, which commits to a bare repository that profileRepo() makes in a
// temporary directory, never to GitHub. Every test waits for its detached sync to end.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { BOT } from "../src/publish/git-readme.ts"
import { lockPath, readState, type State } from "../src/state.ts"
import { assistant, cli, homeWith, POSIX, profileRepo, ROOT, scratch } from "./helpers.ts"

const SESSION = {
  "-home-someone-work-app/session-1.jsonl": [
    assistant({
      id: "msg_1",
      requestId: "req_1",
      timestamp: "2026-11-12T18:00:00.000Z",
      output: 412,
      cacheRead: 96_000_000,
    }),
  ],
}

/** Runs the launcher and returns how it ended and how long it took, in milliseconds. */
function timed(args: readonly string[], env: NodeJS.ProcessEnv) {
  const start = performance.now()
  const result = cli(args, env)
  return { ...result, ms: performance.now() - start }
}

/** Waits until state.json passes `done` and no sync holds the lock, for at most 30 seconds. */
async function settled(dataDir: string, done: (state: State) => boolean): Promise<State> {
  for (const end = Date.now() + 30_000; Date.now() < end; await sleep(50)) {
    const state = readState(dataDir)
    if (done(state) && !existsSync(lockPath(dataDir))) return state
  }
  assert.fail(`the detached sync did not finish: ${JSON.stringify(readState(dataDir))}`)
}

test(
  "sync --trigger returns within a second, then the detached sync commits; the next hook within the hour is skipped",
  POSIX,
  async () => {
    const profile = profileRepo()
    const seen = join(scratch("seen"), "env")
    // git runs the clone's pre-push hook with the sync's own environment.
    const hook = join(profile.clone, ".git", "hooks", "pre-push")
    writeFileSync(
      hook,
      `#!/bin/sh\nprintf '%s|%s|%s|%s\\n' "$GIT_TERMINAL_PROMPT" "$GCM_INTERACTIVE" "$GIT_ASKPASS" "$SSH_ASKPASS_REQUIRE" > '${seen}'\n`,
    )
    chmodSync(hook, 0o755)
    const env = { ...homeWith(SESSION), CLAUDE_PLUGIN_DATA: profile.dataDir, GIT_ASKPASS: "/usr/bin/ksshaskpass" }

    const first = timed(["sync", "--trigger", "Stop"], env)
    assert.deepEqual({ ...first, ms: 0 }, { status: 0, stdout: "", stderr: "", ms: 0 })
    assert.ok(first.ms < 1000, `the hook's command took ${Math.round(first.ms)} ms`)

    const state = await settled(profile.dataDir, (s) => s.result !== undefined)
    assert.equal(state.result, "pushed", JSON.stringify(state))
    assert.equal(state.trigger, "Stop")
    assert.equal(state.lastPush, state.lastSync)
    const [commit, ...older] = profile.log()
    assert.equal(older.length, 1)
    assert.equal(commit.author, `${BOT.name} <${BOT.email}>`)
    assert.match(profile.file("README.md") ?? "", /title="96\.0M tokens on November 12th\."/)
    assert.equal(existsSync(seen), true, "the push ran the pre-push hook")
    assert.equal(readFileSync(seen, "utf8"), "0|never|false|never\n")

    const second = timed(["sync", "--trigger", "Stop"], env)
    assert.deepEqual({ ...second, ms: 0 }, { status: 0, stdout: "", stderr: "", ms: 0 })
    const skipped = await settled(profile.dataDir, (s) => s.skipped !== undefined)
    assert.deepEqual(skipped.skipped?.count, 1)
    assert.equal(skipped.lastSync, state.lastSync)
    assert.equal(profile.log().length, 2, "no second commit within the hour")
  },
)

test("with no config.json, sync --trigger exits 0, prints nothing and writes nothing", POSIX, async () => {
  const env = homeWith(SESSION)
  const empty = scratch("data")
  const gone = join(scratch("uninstalled"), "token-heatmap-token-heatmap")
  for (const trigger of ["SessionStart", "Stop", "SessionEnd"]) {
    for (const run of [
      () => timed(["sync", "--trigger", trigger, "--data-dir", empty], env),
      () => timed(["sync", "--trigger", trigger], { ...env, CLAUDE_PLUGIN_DATA: gone }),
      () => timed(["sync", "--trigger", trigger, "--foreground"], { ...env, CLAUDE_PLUGIN_DATA: gone }),
    ]) {
      const { ms, ...result } = run()
      assert.deepEqual(result, { status: 0, stdout: "", stderr: "" })
      assert.ok(ms < 1000)
    }
  }
  await sleep(500) // a detached sync, had one started, would have made sync.lock by now
  assert.deepEqual(readdirSync(empty), [])
  assert.equal(existsSync(gone), false, "an uninstalled plugin's data directory is not made again")
})

test("sync --foreground --trigger: the limit holds, and status prints what state.json holds", POSIX, async () => {
  const profile = profileRepo()
  const env = { ...homeWith(SESSION), CLAUDE_PLUGIN_DATA: profile.dataDir }
  assert.deepEqual(cli(["sync", "--foreground", "--trigger", "SessionStart"], env), {
    status: 0,
    stdout: "pushed\n",
    stderr: "",
  })
  assert.deepEqual(cli(["sync", "--foreground", "--trigger", "Stop"], env), {
    status: 0,
    stdout: "skipped: the last sync was too recent\n",
    stderr: "",
  })
  assert.equal(cli(["sync", "--foreground"], env).stdout, "unchanged\n")

  const status = cli(["status"], env)
  assert.equal(status.status, 0)
  assert.equal(status.stderr, "")
  assert.match(status.stdout, /^Profile: {4}github\.com\/made-up-user\/made-up-user, machine k3f9a2,/)
  assert.match(
    status.stdout,
    /\nLast sync: {2}\d{4}-\d\d-\d\d \d\d:\d\d \(just now\), run by hand: no number changed, so nothing was pushed\n/,
  )
  assert.match(status.stdout, /\nLast push: {2}\d{4}-\d\d-\d\d \d\d:\d\d \(just now\)\n/)
  assert.doesNotMatch(status.stdout, /Skipped/, "a sync starts the count of skips again")
  assert.deepEqual(cli(["status", "--data-dir", scratch("data")], homeWith({})), {
    status: 0,
    stdout: "token-heatmap is not set up on this machine: run /token-heatmap:setup in Claude Code.\n",
    stderr: "",
  })
  const usage = cli(["status"], homeWith({}))
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /^token-heatmap: status needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set\n/)
})

test("hooks.json: SessionStart, Stop and SessionEnd each run sync --trigger EVENT, async, from a quoted path", () => {
  const { hooks } = JSON.parse(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8"))
  assert.deepEqual(Object.keys(hooks), ["SessionStart", "Stop", "SessionEnd"])
  for (const [event, groups] of Object.entries(hooks)) {
    assert.deepEqual(groups, [
      {
        hooks: [
          {
            type: "command",
            async: true,
            command: `"\${CLAUDE_PLUGIN_ROOT}/bin/token-heatmap" sync --trigger ${event}`,
          },
        ],
      },
    ])
  }
})

test(
  "each hook's command, run by sh from a plugin path with a space, returns at once and the sync commits",
  POSIX,
  async () => {
    const { hooks } = JSON.parse(readFileSync(join(ROOT, "plugin", "hooks", "hooks.json"), "utf8"))
    const root = join(scratch("plugins"), "with space", "token-heatmap")
    for (const part of ["bin", "dist", "assets"])
      cpSync(join(ROOT, "plugin", part), join(root, part), { recursive: true })

    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      const profile = profileRepo()
      const command: string = hooks[event][0].hooks[0].command
      const env = { ...homeWith(SESSION), CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: profile.dataDir }
      const input = JSON.stringify({ session_id: "made-up", hook_event_name: event, cwd: scratch("project") })
      const start = performance.now()
      const run = spawnSync("sh", ["-c", command], { env, input, encoding: "utf8" })
      const ms = performance.now() - start
      assert.deepEqual([run.status, run.stdout, run.stderr], [0, "", ""], event)
      assert.ok(ms < 1000, `${event}: the hook's command took ${Math.round(ms)} ms`)
      const state = await settled(profile.dataDir, (s) => s.result !== undefined)
      assert.deepEqual([state.trigger, state.result], [event, "pushed"])
      assert.equal(profile.log().length, 2)
    }
  },
)
