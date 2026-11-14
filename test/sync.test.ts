// sync, from transcripts to a pushed commit. Each case runs against a bare repository that
// profileRepo() makes in a temporary directory, so nothing reaches GitHub, and every transcript
// is made up.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { claudeCode } from "../src/providers/claude-code.ts"
import { NO_TOKENS, type Provider, type Tokens, totalOf } from "../src/providers/provider.ts"
import { BOT, type Files, publish } from "../src/publish/git-readme.ts"
import { END, START } from "../src/readme.ts"
import { render } from "../src/render.ts"
import { localDate, parseHistory } from "../src/store.ts"
import { sync } from "../src/sync.ts"
import {
  assistant,
  CONFIG,
  GIT_CONFIG_GLOBAL,
  git,
  OWNER,
  profileRepo,
  README,
  scratch,
  transcripts,
} from "./helpers.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const LAUNCHER = join(ROOT, "plugin", "bin", "token-heatmap")
const POSIX = { skip: process.platform === "win32" ? "runs sh" : false }

/** Noon on November 13th in Los Angeles, the zone in CONFIG. */
const NOW = new Date("2026-11-13T20:00:00Z")
const TODAY = "2026-11-13"
const BOT_ID = `${BOT.name} <${BOT.email}>`
const HISTORY = "token-heatmap/history.jsonl"

/**
 * November 12th in Los Angeles: one Opus response written on two lines, and one Sonnet response.
 * 90,001,931 + 6,410,939 = 96,412,870 tokens.
 */
const DAY_12 = [
  assistant({
    id: "msg_1",
    requestId: "req_1",
    timestamp: "2026-11-12T18:00:00.000Z",
    input: 3,
    output: 5,
    cacheWrite: 1500,
    cacheRead: 90_000_000,
  }),
  assistant({
    id: "msg_1",
    requestId: "req_1",
    timestamp: "2026-11-12T18:00:01.000Z",
    input: 3,
    output: 428,
    cacheWrite: 1500,
    cacheRead: 90_000_000,
  }),
  assistant({
    id: "msg_2",
    requestId: "req_2",
    timestamp: "2026-11-12T19:00:00.000Z",
    model: "claude-sonnet-5-5",
    input: 2,
    output: 1000,
    cacheRead: 6_409_937,
  }),
]
const TOKENS_12 = '{"input":5,"output":1428,"cache_write":1500,"cache_read":96409937}'
const LINE_12 =
  `{"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":${TOKENS_12},` +
  '"models":{"claude-opus-5-5":{"input":3,"output":428,"cache_write":1500,"cache_read":90000000},' +
  '"claude-sonnet-5-5":{"input":2,"output":1000,"cache_write":0,"cache_read":6409937}}}\n'

/** What the remote's README must be: `readme`, its empty markers filled with the block for `history`. */
const readmeFor = (history: string, today = TODAY, readme = README) =>
  readme.replace(`${START}\n${END}`, `${START}\n${render(parseHistory(history), today)}\n${END}`)

/** Quotes a value for sh. */
const sh = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

function cli(args: string[], env: NodeJS.ProcessEnv) {
  const { status, stdout, stderr } = spawnSync(LAUNCHER, args, { env, encoding: "utf8" })
  return { status, stdout, stderr }
}

/** An environment whose home holds `files` as Claude Code transcripts, and no CLAUDE_PLUGIN_DATA. */
function homeWith(files: Record<string, readonly string[]>): NodeJS.ProcessEnv {
  const home = scratch("home")
  transcripts(files, join(home, ".claude", "projects"))
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home }
  delete env.CLAUDE_PLUGIN_DATA
  return env
}

// ---------------------------------------------------------------------------------------------
// The outline's cases
// ---------------------------------------------------------------------------------------------

test("first sync: one commit by token-heatmap[bot], and history.jsonl and the block hold the day", async () => {
  const profile = profileRepo()
  const root = transcripts({ "-home-someone-work-app/session-1.jsonl": DAY_12 })
  assert.equal(await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root })], now: NOW }), "pushed")

  const [commit, ...older] = profile.log()
  assert.deepEqual(
    older.map((c) => [c.author, c.subject]),
    [[OWNER, "Write my profile README"]],
  )
  assert.deepEqual(
    { ...commit, sha: "" },
    {
      sha: "",
      author: BOT_ID,
      committer: BOT_ID,
      subject: "Update token heatmap [skip ci]",
      files: ["README.md", HISTORY],
    },
  )
  assert.equal(profile.file(HISTORY), LINE_12)
  const readme = profile.file("README.md") ?? ""
  assert.equal(readme, readmeFor(LINE_12))
  assert.match(readme, /<b>96\.41M<\/b> Claude Code tokens in the last year/)
  assert.match(readme, /title="96\.4M tokens on November 12th\."/)
  assert.match(readme, /title="No tokens on November 13th\."/)
  // The clone is left at the pushed commit, with nothing else in it.
  assert.equal(git(profile.clone, ["rev-parse", "HEAD"]).trim(), commit.sha)
  assert.equal(git(profile.clone, ["status", "--porcelain", "--ignored"]), "")
})

test("nothing new: no commit", async () => {
  const profile = profileRepo()
  const providers = [claudeCode({ root: transcripts({ "app/session-1.jsonl": DAY_12 }) })]
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
  const log = profile.log()
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "unchanged")
  // 23:59:59 on the 13th in Los Angeles, so the grid ends on the same day.
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: new Date("2026-11-14T07:59:59Z") }), "unchanged")
  assert.deepEqual(profile.log(), log)
})

test("the remote moves before the push: after one redo, the remote holds both changes", POSIX, async () => {
  const profile = profileRepo()
  const root = transcripts({ "app/session-1.jsonl": DAY_12 })
  // A pre-commit hook in the clone runs between sync's fetch and its push. The first time, the
  // owner pushes an edit of the README from another clone, so the push that follows is refused.
  const mark = join(scratch("hook"), "ran")
  const hook = join(profile.clone, ".git", "hooks", "pre-commit")
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      `[ -e ${sh(mark)} ] && exit 0`,
      `: > ${sh(mark)}`,
      "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX",
      "unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL",
      `other=${sh(join(scratch("owner"), "clone"))}`,
      `git clone --quiet ${sh(profile.remote)} "$other" &&`,
      `printf 'A line the owner added.\\n' >> "$other/README.md" &&`,
      `git -C "$other" -c user.name='Profile Owner' -c user.email=owner@example.com -c commit.gpgsign=false \\`,
      "  commit --quiet --all --message 'Add a line below the block' &&",
      'git -C "$other" push --quiet origin HEAD:refs/heads/main',
      "",
    ].join("\n"),
  )
  chmodSync(hook, 0o755)

  assert.equal(await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root })], now: NOW }), "pushed")
  assert.ok(existsSync(mark), "the hook moved the remote")
  const [ours, theirs, first] = profile.log()
  assert.deepEqual(
    [ours, theirs, first].map((c) => [c.author, c.subject]),
    [
      [BOT_ID, "Update token heatmap [skip ci]"],
      [OWNER, "Add a line below the block"],
      [OWNER, "Write my profile README"],
    ],
  )
  assert.equal(git(profile.remote, ["rev-parse", `${ours.sha}^`]).trim(), theirs.sha, "ours comes after theirs")
  assert.equal(profile.file(HISTORY), LINE_12)
  assert.equal(profile.file("README.md"), readmeFor(LINE_12, TODAY, `${README}A line the owner added.\n`))
})

test("the markers are missing: no commit, exit 1, README untouched", POSIX, () => {
  const readme = "# Hi, I'm a made-up user\n\nA README with no markers.\n"
  const profile = profileRepo({ readme })
  const env = homeWith({ "app/session-1.jsonl": DAY_12 })
  const log = profile.log()

  assert.deepEqual(cli(["sync", "--foreground", "--data-dir", profile.dataDir], env), {
    status: 1,
    stdout: "",
    stderr: `token-heatmap: README.md has no "${START}" line followed by an "${END}" line, so the block has nowhere to go\n`,
  })
  assert.deepEqual(profile.log(), log)
  assert.equal(profile.file("README.md"), readme)
  assert.equal(profile.file(HISTORY), undefined)
  assert.equal(readFileSync(join(profile.clone, "README.md"), "utf8"), readme)
  assert.equal(existsSync(join(profile.clone, "token-heatmap")), false)
  assert.equal(git(profile.clone, ["status", "--porcelain", "--ignored"]), "")
})

test("the transcripts are deleted, then sync: no day is lost", async () => {
  const profile = profileRepo()
  const root = transcripts({
    "app/session-1.jsonl": [
      assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-10T18:00:00Z", output: 10, cacheRead: 1000 }),
    ],
    "app/session-2.jsonl": [
      assistant({ id: "msg_2", requestId: "req_2", timestamp: "2026-11-11T18:00:00Z", output: 20, cacheRead: 2000 }),
      assistant({
        id: "msg_3",
        requestId: "req_3",
        timestamp: "2026-11-11T19:00:00Z",
        model: "claude-sonnet-5-5",
        output: 30,
      }),
    ],
    "app/session-3.jsonl": [
      assistant({ id: "msg_4", requestId: "req_4", timestamp: "2026-11-11T20:00:00Z", output: 40, cacheRead: 4000 }),
    ],
  })
  const providers = [claudeCode({ root })]
  const days = () =>
    parseHistory(profile.file(HISTORY) ?? "").map((line) => [line.date, totalOf(line.tokens)] as [string, number])
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
  const first = parseHistory(profile.file(HISTORY) ?? "")
  assert.deepEqual(days(), [
    ["2026-11-10", 1010],
    ["2026-11-11", 6090],
  ])

  // Claude Code deletes old transcripts: all of the 10th, and part of the 11th. The 12th is new.
  rmSync(join(root, "app", "session-1.jsonl"))
  rmSync(join(root, "app", "session-3.jsonl"))
  transcripts(
    {
      "app/session-4.jsonl": [
        assistant({ id: "msg_5", requestId: "req_5", timestamp: "2026-11-12T18:00:00Z", output: 50 }),
      ],
    },
    root,
  )
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
  assert.deepEqual(parseHistory(profile.file(HISTORY) ?? "").slice(0, 2), first)
  assert.deepEqual(days(), [
    ["2026-11-10", 1010],
    ["2026-11-11", 6090],
    ["2026-11-12", 50],
  ])

  // Every transcript gone: nothing changes, and the block still shows the three days.
  rmSync(root, { recursive: true })
  const log = profile.log()
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "unchanged")
  assert.deepEqual(profile.log(), log)
  assert.equal(profile.file("README.md"), readmeFor(profile.file(HISTORY) ?? ""))
})

test('"models": false: lines hold only tokens, and a day is replaced only by a higher total', async () => {
  const profile = profileRepo({ config: { models: false } })
  const root = transcripts({ "app/session-1.jsonl": DAY_12 })
  const providers = [claudeCode({ root })]
  const tokensOnly = (tokens: string) =>
    `{"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":${tokens}}\n`

  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
  assert.equal(profile.file(HISTORY), tokensOnly(TOKENS_12))

  // More usage that day, under a third model: the higher total replaces the line.
  transcripts(
    {
      "app/session-2.jsonl": [
        assistant({
          id: "msg_3",
          requestId: "req_3",
          timestamp: "2026-11-12T22:00:00Z",
          model: "claude-haiku-5-5",
          output: 100,
        }),
      ],
    },
    root,
  )
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "pushed")
  const higher = '{"input":5,"output":1528,"cache_write":1500,"cache_read":96409937}'
  assert.equal(profile.file(HISTORY), tokensOnly(higher))

  // The first session deleted: a lower total, which changes nothing.
  rmSync(join(root, "app", "session-1.jsonl"))
  assert.equal(await sync({ dataDir: profile.dataDir, providers, now: NOW }), "unchanged")
  assert.equal(profile.file(HISTORY), tokensOnly(higher))
  for (const file of [HISTORY, "README.md"]) {
    assert.doesNotMatch(profile.file(file) ?? "", /models|claude-(opus|sonnet|haiku)/, file)
  }
})

test("a fake second provider in the list: its days reach the block through the same store, render and publish", async () => {
  const profile = profileRepo()
  const root = transcripts({ "app/session-1.jsonl": DAY_12 })
  const counts = (cache_read: number): Tokens => ({ input: 0, output: 0, cache_write: 0, cache_read })
  const zones: string[] = []
  const fake: Provider = {
    id: "fake-tool",
    async collect({ timeZone }) {
      zones.push(timeZone)
      return [
        {
          date: "2026-11-05",
          provider: "fake-tool",
          tokens: counts(684_531),
          models: { "fake-model": counts(684_531) },
        },
        {
          date: "2026-11-12",
          provider: "fake-tool",
          tokens: counts(3_587_130),
          models: { "fake-model": counts(3_587_130) },
        },
      ]
    },
  }
  assert.equal(await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root }), fake], now: NOW }), "pushed")
  assert.deepEqual(zones, ["America/Los_Angeles"])

  const history = profile.file(HISTORY) ?? ""
  assert.deepEqual(
    parseHistory(history).map((line) => [line.date, line.provider, line.machine, totalOf(line.tokens)]),
    [
      ["2026-11-05", "fake-tool", "k3f9a2", 684_531],
      ["2026-11-12", "claude-code", "k3f9a2", 96_412_870],
      ["2026-11-12", "fake-tool", "k3f9a2", 3_587_130],
    ],
  )
  const readme = profile.file("README.md") ?? ""
  assert.equal(readme, readmeFor(history))
  assert.match(readme, /title="684\.5K tokens on November 5th\."/)
  assert.match(readme, /title="100\.0M tokens on November 12th\."/) // 96,412,870 + 3,587,130
  assert.match(readme, /<b>100\.68M<\/b> Claude Code tokens in the last year/)
})

// ---------------------------------------------------------------------------------------------
// What publish promises
// ---------------------------------------------------------------------------------------------

test("a provider's days must carry its own id", async () => {
  const profile = profileRepo()
  const impostor: Provider = {
    id: "fake-tool",
    collect: async () => [{ date: "2026-11-12", provider: "claude-code", tokens: { ...NO_TOKENS } }],
  }
  await assert.rejects(sync({ dataDir: profile.dataDir, providers: [impostor], now: NOW }), {
    message: 'provider fake-tool returned a day of "claude-code"',
  })
  assert.equal(profile.log().length, 1)
})

test("publish: a push refused twice stops with an error, and forces nothing", async () => {
  const profile = profileRepo()
  const seen: Files[] = []
  await assert.rejects(
    publish(profile.dataDir, (current) => {
      seen.push(current)
      // The remote moves after every fetch.
      profile.edit("README.md", (text) => `${text}Edit ${seen.length}.\n`, `Edit ${seen.length}`)
      return { history: LINE_12, readme: `${current.readme}A change of ours.\n` }
    }),
    { message: /^the push to main was refused twice, because the profile repository changed while sync ran\./ },
  )
  assert.deepEqual(seen, [
    { history: "", readme: README },
    { history: "", readme: `${README}Edit 1.\n` },
  ])
  assert.deepEqual(
    profile.log().map((c) => [c.author, c.subject]),
    [
      [OWNER, "Edit 2"],
      [OWNER, "Edit 1"],
      [OWNER, "Write my profile README"],
    ],
  )
})

test(
  "publish: a push the remote declines fails at once, with git's reason, and is not tried again",
  POSIX,
  async () => {
    const profile = profileRepo()
    // As a protected branch would: a hook on the remote declines every push.
    const hook = join(profile.remote, "hooks", "pre-receive")
    writeFileSync(hook, "#!/bin/sh\necho 'this branch is protected' >&2\nexit 1\n")
    chmodSync(hook, 0o755)
    let calls = 0
    await assert.rejects(
      publish(profile.dataDir, (current) => {
        calls++
        return { history: LINE_12, readme: current.readme }
      }),
      (error: Error) =>
        error.name === "GitError" &&
        error.message.startsWith("git push failed: remote: this branch is protected") &&
        error.message.includes("\n!\tHEAD:refs/heads/main\t[remote rejected] (pre-receive hook declined)"),
    )
    assert.equal(calls, 1)
    assert.equal(profile.log().length, 1)
  },
)

/**
 * A stand-in for ssh, a file named ssh in a new directory. It writes down how git called it, then
 * serves the bare repository on this machine, so an ssh:// address works with no network.
 */
function fakeSsh(): { path: string; calls: () => string[] } {
  const bin = scratch("bin")
  const path = join(bin, "ssh")
  const log = join(bin, "calls.log")
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `printf '%s\\n' "GIT_TERMINAL_PROMPT=\${GIT_TERMINAL_PROMPT-unset} $*" >> ${sh(log)}`,
      "for last; do :; done",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: sh's own ${…}, turning git-upload-pack into git upload-pack
      'exec sh -c "git ${last#git-}"',
      "",
    ].join("\n"),
  )
  chmodSync(path, 0o755)
  return { path, calls: () => readFileSync(log, "utf8").trimEnd().split("\n") }
}

test("publish: commands that reach the remote run with GIT_TERMINAL_PROMPT=0 and ssh's BatchMode", POSIX, async (t) => {
  // git runs plain ssh, GIT_SSH_COMMAND, or the clone's core.sshCommand. BatchMode comes after
  // the user's own options. Each case undoes what it set.
  const ways: [string, string, (ssh: string, clone: string) => () => void][] = [
    [
      "ssh on PATH",
      "",
      (ssh) => {
        const path = process.env.PATH
        process.env.PATH = `${join(ssh, "..")}:${path}`
        return () => {
          process.env.PATH = path
        }
      },
    ],
    [
      "GIT_SSH_COMMAND",
      "-o ConnectTimeout=9 ",
      (ssh) => {
        process.env.GIT_SSH_COMMAND = `${sh(ssh)} -o ConnectTimeout=9`
        return () => {
          delete process.env.GIT_SSH_COMMAND
        }
      },
    ],
    [
      "core.sshCommand",
      "-o ConnectTimeout=7 ",
      (ssh, clone) => {
        git(clone, ["config", "core.sshCommand", `${sh(ssh)} -o ConnectTimeout=7`])
        return () => {}
      },
    ],
  ]
  for (const [way, options, setUp] of ways) {
    await t.test(way, async () => {
      const profile = profileRepo()
      const root = transcripts({ "app/session-1.jsonl": DAY_12 })
      const ssh = fakeSsh()
      // A reserved host name: nothing connects to it.
      git(profile.clone, ["remote", "set-url", "origin", `ssh://token-heatmap.invalid${profile.remote}`])
      const undo = setUp(ssh.path, profile.clone)
      let result: string
      try {
        result = await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root })], now: NOW })
      } finally {
        undo()
      }
      assert.equal(result, "pushed")
      assert.equal(profile.file(HISTORY), LINE_12)
      const calls = ssh.calls()
      assert.deepEqual(
        calls.map((call) => / (git-[a-z-]+) /.exec(call)?.[1]),
        ["git-upload-pack", "git-upload-pack", "git-receive-pack"], // ls-remote, fetch, push
      )
      for (const call of calls) {
        assert.ok(call.startsWith(`GIT_TERMINAL_PROMPT=0 ${options}-o BatchMode=yes `), call)
        assert.match(call, / token-heatmap\.invalid git-/)
      }
    })
  }
})

test("publish: the commit is the bot's and unsigned, whatever this machine's git config and environment say", async () => {
  const profile = profileRepo()
  const root = transcripts({ "app/session-1.jsonl": DAY_12 })
  const someone = { name: "Someone Else", email: "someone@example.com" }
  const identity = `\tname = ${someone.name}\n\temail = ${someone.email}\n`
  // gpg.program = false: a commit that tried to sign would fail.
  writeFileSync(
    GIT_CONFIG_GLOBAL,
    `[user]\n${identity}[author]\n${identity}[committer]\n${identity}[commit]\n\tgpgSign = true\n[gpg]\n\tprogram = false\n`,
  )
  const variables = {
    GIT_AUTHOR_NAME: someone.name,
    GIT_AUTHOR_EMAIL: someone.email,
    GIT_COMMITTER_NAME: someone.name,
    GIT_COMMITTER_EMAIL: someone.email,
  }
  Object.assign(process.env, variables)
  let result: string
  try {
    result = await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root })], now: NOW })
  } finally {
    writeFileSync(GIT_CONFIG_GLOBAL, "")
    for (const name of Object.keys(variables)) delete process.env[name]
  }
  assert.equal(result, "pushed")
  const [commit] = profile.log()
  assert.deepEqual([commit.author, commit.committer], [BOT_ID, BOT_ID])
  assert.doesNotMatch(git(profile.remote, ["cat-file", "commit", commit.sha]), /^gpgsig/m)
})

// ---------------------------------------------------------------------------------------------
// The command line: plugin/bin/token-heatmap, and the bundle `npm run check` builds first
// ---------------------------------------------------------------------------------------------

test(
  "sync --foreground --data-dir DIR prints pushed, then unchanged; CLAUDE_PLUGIN_DATA stands in for --data-dir",
  POSIX,
  () => {
    const profile = profileRepo()
    const env = homeWith({ "-home-someone-work-app/session-1.jsonl": DAY_12 })
    const today = () => localDate(new Date(), CONFIG.timeZone)

    const before = today()
    assert.deepEqual(cli(["sync", "--foreground", "--data-dir", profile.dataDir], env), {
      status: 0,
      stdout: "pushed\n",
      stderr: "",
    })
    assert.equal(profile.file(HISTORY), LINE_12)
    assert.ok(
      [before, today()].some((day) => profile.file("README.md") === readmeFor(LINE_12, day)),
      "the grid ends on today in the configured zone",
    )
    const again = cli(["sync", "--foreground"], { ...env, CLAUDE_PLUGIN_DATA: profile.dataDir })
    assert.equal(again.status, 0)
    if (before === today()) assert.equal(again.stdout, "unchanged\n")
    assert.equal(profile.log().length, again.stdout === "pushed\n" ? 3 : 2)
  },
)

test("sync: a command line that cannot run exits 2; a data dir with no config.json exits 1", POSIX, () => {
  const env = homeWith({})
  const cases: [string[], string][] = [
    [["sync"], "sync runs only with --foreground for now"],
    [["sync", "--foreground"], "sync needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set"],
    [["sync", "--foreground", "--data-dir"], "Option '--data-dir <value>' argument missing"],
    [["sync", "--foreground", "--trigger", "Stop"], "Unknown option '--trigger'"],
  ]
  for (const [args, reason] of cases) {
    const { status, stdout, stderr } = cli(args, env)
    assert.equal(status, 2, args.join(" "))
    assert.equal(stdout, "")
    assert.ok(stderr.startsWith(`token-heatmap: ${reason}\n\nusage: token-heatmap render`), stderr)
  }
  const empty = scratch("data")
  assert.deepEqual(cli(["sync", "--foreground", "--data-dir", empty], env), {
    status: 1,
    stdout: "",
    stderr: `token-heatmap: ${join(empty, "config.json")} does not exist. Run /token-heatmap:setup in Claude Code first\n`,
  })
})
