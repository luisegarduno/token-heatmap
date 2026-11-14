// setup: the plan, then the first push. Each case runs against a bare repository that
// profileRepo() makes in a temporary directory. onGitHub() makes setup's github.com addresses
// lead there, and lets git reach no address but a file:// one, so nothing reaches GitHub. Every
// transcript is made up.

import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { type Config, configPath, newMachineId, readConfig, writeConfig } from "../src/config.ts"
import { claudeCode } from "../src/providers/claude-code.ts"
import { addresses, BOT, COMMIT_MESSAGE } from "../src/publish/git-readme.ts"
import { END, START } from "../src/readme.ts"
import { IMAGE_FILES, render } from "../src/render.ts"
import { profileRepository, type SetupOptions, setup } from "../src/setup.ts"
import { localDate, parseHistory } from "../src/store.ts"
import { sync } from "../src/sync.ts"
import {
  ASSETS,
  assistant,
  CONFIG,
  cli,
  git,
  homeWith,
  OWNER,
  onGitHub,
  POSIX,
  type Profile,
  profileRepo,
  README,
  scratch,
  transcripts,
} from "./helpers.ts"

// No test in this file reaches anything but a file:// address, even before its own onGitHub().
onGitHub()

/** Noon on November 13th in Los Angeles. */
const NOW = new Date("2026-11-13T20:00:00Z")
const TODAY = "2026-11-13"
const ZONE = "America/Los_Angeles"
const USER = "made-up-user"
const REPOSITORY = CONFIG.repository
const HISTORY = "token-heatmap/history.jsonl"
const BOT_ID = `${BOT.name} <${BOT.email}>`
/** Every file setup's commit touches when it adds the block to a README for the first time. */
const FIRST_COMMIT = ["README.md", ...[HISTORY, ...IMAGE_FILES.map((name) => `token-heatmap/${name}`)].sort()]

/** A profile README of the owner's own, with no markers. */
const OWN = "# Hi, I'm a made-up user\n\nSome text of my own, and no markers.\n"

/** November 11th and 12th in Los Angeles: an Opus response written on two lines, then a Sonnet one. */
const DAYS = {
  "-home-someone-work-app/session-1.jsonl": [
    assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-11T18:00:00.000Z", output: 5, cacheRead: 1000 }),
    assistant({ id: "msg_1", requestId: "req_1", timestamp: "2026-11-11T18:00:01.000Z", output: 50, cacheRead: 1000 }),
    assistant({
      id: "msg_2",
      requestId: "req_2",
      timestamp: "2026-11-12T19:00:00.000Z",
      model: "claude-sonnet-5-5",
      input: 2,
      output: 70,
      cacheRead: 2000,
    }),
  ],
}
const T11 = '{"input":0,"output":50,"cache_write":0,"cache_read":1000}'
const T12 = '{"input":2,"output":70,"cache_write":0,"cache_read":2000}'

/** history.jsonl for DAYS, as the lines of `machine`. */
const linesFor = (machine: string, models = true) =>
  `{"date":"2026-11-11","provider":"claude-code","machine":"${machine}","tokens":${T11}${models ? `,"models":{"claude-opus-5-5":${T11}}` : ""}}\n` +
  `{"date":"2026-11-12","provider":"claude-code","machine":"${machine}","tokens":${T12}${models ? `,"models":{"claude-sonnet-5-5":${T12}}` : ""}}\n`

/** A line of a machine other than this one, with made-up counts. */
const otherLine = (machine: string, date = "2026-11-10") =>
  `{"date":"${date}","provider":"claude-code","machine":"${machine}","tokens":{"input":0,"output":30,"cache_write":0,"cache_read":400}}\n`

/** What setup leaves as README.md: `readme`, the markers added at its end, and the block for `history`. */
const readmeFor = (history: string, readme = OWN, today = TODAY) =>
  `${readme}\n${START}\n${render(parseHistory(history), today)}\n${END}\n`

/** setup's options for `profile`, with DAYS as the transcripts unless `root` is given. */
const options = (profile: Profile, o: Partial<SetupOptions> & { root?: string } = {}): SetupOptions => {
  const { root, ...rest } = o
  return {
    dataDir: profile.dataDir,
    repository: REPOSITORY,
    yes: false,
    providers: [claudeCode({ root: root ?? transcripts(DAYS) })],
    now: NOW,
    assets: ASSETS,
    ...rest,
  }
}

/** The first setup, in Los Angeles, with --yes. */
const setUp = (profile: Profile, o: Partial<SetupOptions> & { root?: string } = {}) =>
  setup(options(profile, { timeZone: ZONE, yes: true, ...o }))

/** The clone is at the remote's main, with nothing else in it. */
function assertClean(profile: Profile): void {
  assert.equal(git(profile.clone, ["rev-parse", "HEAD"]).trim(), profile.log()[0].sha)
  assert.equal(git(profile.clone, ["status", "--porcelain", "--ignored"]), "")
}

const count = (text: string, part: string) => text.split(part).length - 1

// ---------------------------------------------------------------------------------------------
// The outline's cases
// ---------------------------------------------------------------------------------------------

test("no --yes: the plan lists the model names, and no file changes and no commit", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  const log = profile.log()
  // No address leads anywhere, so a plan that reached for the network would fail.
  onGitHub()

  const report = await setup(options(profile, { timeZone: ZONE }))
  assert.equal(report.done, "planned")
  assert.equal(
    report.text,
    [
      "token-heatmap setup: the plan. Nothing has changed yet.",
      "",
      "  Repository   github.com/made-up-user/made-up-user, its default branch",
      "  Time zone    America/Los_Angeles: it decides which day each response counts on",
      "  Machine id   a new random one",
      "  Days found   2 days with usage, 2026-11-11 to 2026-11-12",
      "  Model names  claude-opus-5-5, claude-sonnet-5-5",
      "",
      "With --yes, setup pushes one commit by token-heatmap[bot] to github.com/made-up-user/made-up-user: README.md " +
        "with the block between two marker lines, added at its end if it has none, and in token-heatmap/, history.jsonl " +
        `and the block's ${IMAGE_FILES.length} images.`,
      "history.jsonl holds, for each day: the date, the provider, this machine's id, and the token counts by type " +
        "and by model. A model name first seen later is published too.",
      "What is pushed stays in the repository's git history.",
      "Run setup again with --yes to publish.",
      "",
    ].join("\n"),
  )
  assert.deepEqual(readdirSync(profile.dataDir), [])
  assert.deepEqual(profile.log(), log)

  const without = await setup(options(profile, { timeZone: ZONE, models: false }))
  assert.match(without.text, /^ {2}Model names {2}none: --no-models keeps them out$/m)
  assert.match(without.text, /the token counts by type\.$/m)
  assert.doesNotMatch(without.text, /claude-/)

  const empty = await setup(options(profile, { timeZone: ZONE, root: transcripts({}) }))
  assert.match(empty.text, /^ {2}Days found {3}none yet: the block shows a year of no tokens until there is usage$/m)
  assert.match(empty.text, /^ {2}Model names {2}none found yet$/m)

  // A data dir that does not exist yet is not made.
  const missing = join(scratch("data"), "not-yet")
  assert.equal((await setup({ ...options(profile, { timeZone: ZONE }), dataDir: missing })).done, "planned")
  assert.equal(existsSync(missing), false)
  assert.deepEqual(readdirSync(profile.dataDir), [])
})

test("--yes, a README without markers: markers and block at its end, the rest unchanged, images copied, one bot commit", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  onGitHub(profile.remote)
  const report = await setUp(profile)
  assert.equal(report.done, "pushed")

  const config = readConfig(profile.dataDir)
  assert.match(config.machine, /^[a-z0-9]{6}$/)
  assert.deepEqual(config, { repository: REPOSITORY, timeZone: ZONE, machine: config.machine, models: true })

  const [commit, ...older] = profile.log()
  assert.deepEqual(
    older.map((c) => [c.author, c.subject]),
    [[OWNER, "Write my profile README"]],
  )
  assert.deepEqual(
    { ...commit, sha: "" },
    { sha: "", author: BOT_ID, committer: BOT_ID, subject: COMMIT_MESSAGE, files: FIRST_COMMIT },
  )
  const history = profile.file(HISTORY) ?? ""
  assert.equal(history, linesFor(config.machine))
  const readme = profile.file("README.md") ?? ""
  assert.ok(readme.startsWith(OWN), "the owner's text comes first, as it was")
  assert.equal(readme, readmeFor(history))
  assert.match(readme, /title="1\.1K tokens on November 11th\."/)
  for (const name of IMAGE_FILES) {
    assert.equal(profile.file(`token-heatmap/${name}`), readFileSync(join(ASSETS, name), "utf8"), name)
  }

  assertClean(profile)
  assert.equal(git(profile.clone, ["config", "--get", "remote.origin.url"]).trim(), addresses(REPOSITORY).https)
  assert.equal(
    report.text,
    "Pushed one commit by token-heatmap[bot] to github.com/made-up-user/made-up-user. The profile shows it at " +
      "https://github.com/made-up-user\n" +
      `This machine's id is ${config.machine}, and config.json in ${profile.dataDir} holds it.\n`,
  )
})

test("--yes a second time: no second pair of markers and no commit; the machine id stays, and sync goes on from there", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  onGitHub(profile.remote)
  const root = transcripts(DAYS)
  assert.equal((await setUp(profile, { root })).done, "pushed")
  const config = readFileSync(configPath(profile.dataDir), "utf8")
  const { machine } = readConfig(profile.dataDir)
  const log = profile.log()

  // The plan on a machine that is set up shows its id, and changes nothing.
  const plan = await setup(options(profile, { root }))
  assert.match(plan.text, new RegExp(`^ {2}Machine id {3}${machine}, from config\\.json$`, "m"))
  assert.match(plan.text, /^ {2}Time zone {4}America\/Los_Angeles: /m)
  assert.deepEqual(profile.log(), log)

  const again = await setup(options(profile, { root, yes: true }))
  assert.equal(again.done, "unchanged")
  assert.equal(
    again.text,
    "github.com/made-up-user/made-up-user has this block, history and images already, so nothing was pushed.\n" +
      `This machine's id is ${machine}, and config.json in ${profile.dataDir} holds it.\n`,
  )
  assert.deepEqual(profile.log(), log)
  assert.equal(readFileSync(configPath(profile.dataDir), "utf8"), config)
  assertClean(profile)

  // More usage, then setup once more: one commit of the two files, one pair of markers, the same id.
  transcripts(
    {
      "app/session-2.jsonl": [
        assistant({ id: "msg_3", requestId: "req_3", timestamp: "2026-11-13T18:00:00Z", output: 9 }),
      ],
    },
    root,
  )
  assert.equal((await setup(options(profile, { root, yes: true }))).done, "pushed")
  const [third] = profile.log()
  assert.deepEqual(third.files, ["README.md", HISTORY])
  const readme = profile.file("README.md") ?? ""
  assert.deepEqual([count(readme, START), count(readme, END)], [1, 1])
  assert.equal(readme, readmeFor(profile.file(HISTORY) ?? ""))
  assert.equal(readFileSync(configPath(profile.dataDir), "utf8"), config)

  // sync works on the data dir setup made, and its commit touches only its two files.
  transcripts(
    {
      "app/session-3.jsonl": [
        assistant({ id: "msg_4", requestId: "req_4", timestamp: "2026-11-13T19:00:00Z", output: 7 }),
      ],
    },
    root,
  )
  assert.equal(await sync({ dataDir: profile.dataDir, providers: [claudeCode({ root })], now: NOW }), "pushed")
  const [synced] = profile.log()
  assert.deepEqual([synced.author, synced.files], [BOT_ID, ["README.md", HISTORY]])
  assert.match(
    profile.file(HISTORY) ?? "",
    new RegExp(`^\\{"date":"2026-11-13","provider":"claude-code","machine":"${machine}",`, "m"),
  )
  assert.deepEqual([count(profile.file("README.md") ?? "", START), profile.log().length], [1, log.length + 2])
})

test("the history holds another machine's id: setup stops and names it, and --adopt goes on with it", async () => {
  const other = otherLine("p7m2x1")
  const profile = profileRepo({ readme: OWN, files: { [HISTORY]: other }, config: null })
  onGitHub(profile.remote)
  const log = profile.log()

  await assert.rejects(setUp(profile), {
    message:
      "token-heatmap/history.jsonl in made-up-user/made-up-user has the lines of another machine, p7m2x1, and none of this one's. Nothing was published.\n" +
      "If they are this machine's own, from an earlier install, run setup again with --adopt p7m2x1 to go on with them.\n" +
      "If another machine still publishes to this profile, set it up there only: token-heatmap publishes from one machine.",
  })
  assert.deepEqual(profile.log(), log)
  assert.equal(existsSync(configPath(profile.dataDir)), false)
  assertClean(profile)

  // --adopt must name an id the history holds.
  await assert.rejects(setUp(profile, { adopt: "q8n3y2" }), {
    message:
      "--adopt q8n3y2: token-heatmap/history.jsonl in made-up-user/made-up-user has no lines of that machine, only of p7m2x1. Nothing was published",
  })
  assert.deepEqual(profile.log(), log)

  const plan = await setup(options(profile, { timeZone: ZONE, adopt: "p7m2x1" }))
  assert.match(plan.text, /^ {2}Machine id {3}p7m2x1, taken over with --adopt: the history must have lines of it$/m)

  assert.equal((await setUp(profile, { adopt: "p7m2x1" })).done, "pushed")
  assert.equal(readConfig(profile.dataDir).machine, "p7m2x1")
  assert.equal(profile.file(HISTORY), other + linesFor("p7m2x1"))
  assert.deepEqual(profile.log()[0].files, FIRST_COMMIT)

  // From then on, this machine is p7m2x1, with no --adopt.
  assert.equal((await setup(options(profile, { yes: true }))).done, "unchanged")
})

test("other machines' ids: setup names them all; --adopt one, and the others' lines stay as they are", async () => {
  const others = otherLine("q8n3y2", "2026-11-09") + otherLine("p7m2x1")
  const profile = profileRepo({ readme: OWN, files: { [HISTORY]: others }, config: null })
  onGitHub(profile.remote)
  await assert.rejects(setUp(profile), {
    message: new RegExp(
      "^token-heatmap/history\\.jsonl in made-up-user/made-up-user has the lines of other machines, p7m2x1 and q8n3y2, " +
        "and none of this one's\\. Nothing was published\\.\\n" +
        "If one of them is this machine's own, from an earlier install, run setup again with --adopt and its id to go on with it\\.\\n",
    ),
  })
  await assert.rejects(setUp(profile, { adopt: "k3f9a2" }), {
    message: /^--adopt k3f9a2: .* has no lines of that machine, only of p7m2x1 and q8n3y2\. Nothing was published$/,
  })

  const report = await setUp(profile, { adopt: "q8n3y2" })
  assert.equal(report.done, "pushed")
  assert.match(report.text, /^The lines of p7m2x1 in history\.jsonl stay as they are\.$/m)
  const history = profile.file(HISTORY) ?? ""
  assert.equal(history, otherLine("q8n3y2", "2026-11-09") + otherLine("p7m2x1") + linesFor("q8n3y2"))
  // The block counts every machine's lines, as it did before.
  assert.match(profile.file("README.md") ?? "", /title="430 tokens on November 10th\."/)

  // A machine that is in the history goes on beside the others with no --adopt.
  assert.equal((await setup(options(profile, { yes: true }))).done, "unchanged")
})

test("--no-models: no line has a models key, later runs keep it so, and only --models turns it back on", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  onGitHub(profile.remote)
  const root = transcripts(DAYS)
  assert.equal((await setUp(profile, { root, models: false })).done, "pushed")
  const { machine } = readConfig(profile.dataDir)
  assert.equal(readConfig(profile.dataDir).models, false)
  assert.equal(profile.file(HISTORY), linesFor(machine, false))
  const noModels = () => {
    for (const line of (profile.file(HISTORY) ?? "").trimEnd().split("\n")) {
      assert.deepEqual(Object.keys(JSON.parse(line)), ["date", "provider", "machine", "tokens"], line)
    }
    for (const file of [HISTORY, "README.md"]) {
      assert.doesNotMatch(profile.file(file) ?? "", /models|claude-(opus|sonnet)/, file)
    }
  }
  noModels()

  // A run with no flag, after more usage, keeps the names out, and the plan says why.
  transcripts(
    {
      "app/session-2.jsonl": [
        assistant({ id: "msg_3", requestId: "req_3", timestamp: "2026-11-13T18:00:00Z", output: 9 }),
      ],
    },
    root,
  )
  const plan = await setup(options(profile, { root }))
  assert.match(
    plan.text,
    /^ {2}Model names {2}none: this machine is set up with --no-models, and --models would publish them$/m,
  )
  assert.equal((await setup(options(profile, { root, yes: true }))).done, "pushed")
  assert.equal(readConfig(profile.dataDir).models, false)
  noModels()

  // --models: a day recorded from now on holds its names; the days recorded without them stay so.
  transcripts(
    {
      "app/session-3.jsonl": [
        assistant({ id: "msg_4", requestId: "req_4", timestamp: "2026-11-10T18:00:00Z", output: 4 }),
      ],
    },
    root,
  )
  assert.equal((await setup(options(profile, { root, yes: true, models: true }))).done, "pushed")
  assert.equal(readConfig(profile.dataDir).models, true)
  assert.deepEqual(
    parseHistory(profile.file(HISTORY) ?? "").map((line) => [line.date, "models" in line]),
    [
      ["2026-11-10", true],
      ["2026-11-11", false],
      ["2026-11-12", false],
      ["2026-11-13", false],
    ],
  )
})

test("--timezone after setup: config.json changes and history.jsonl does not", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  onGitHub(profile.remote)
  await setUp(profile)
  const before = readConfig(profile.dataDir)
  const history = profile.file(HISTORY)
  const readme = profile.file("README.md")
  const log = profile.log()
  const unchanged = () => {
    assert.equal(profile.file(HISTORY), history)
    assert.equal(profile.file("README.md"), readme)
    assert.deepEqual(profile.log(), log)
    assertClean(profile)
  }

  const plan = await setup(options(profile, { timeZone: "Europe/Berlin" }))
  assert.deepEqual(plan, {
    done: "planned",
    text:
      "token-heatmap setup: the plan. Nothing has changed yet.\n\n" +
      "  Time zone    America/Los_Angeles, to become Europe/Berlin\n\n" +
      "Only config.json changes. Nothing is pushed, and the days already in history.jsonl stay as they are. " +
      "From the next sync on, days are counted in Europe/Berlin.\n" +
      "Run setup again with --yes to make the change.\n",
  })
  assert.deepEqual(readConfig(profile.dataDir), before)

  // The zone as typed, in any case, is written as Node.js spells it.
  const report = await setup(options(profile, { timeZone: "europe/berlin", yes: true }))
  assert.deepEqual(report, {
    done: "configured",
    text: "config.json now counts days in Europe/Berlin. Nothing is pushed, and the days already in history.jsonl stay as they are.\n",
  })
  assert.deepEqual(readConfig(profile.dataDir), { ...before, timeZone: "Europe/Berlin" })
  unchanged()

  assert.equal((await setup(options(profile, { timeZone: "Europe/Berlin", yes: true }))).done, "unchanged")
  // With --no-models as well, config.json takes both, and still nothing is pushed.
  assert.equal((await setup(options(profile, { timeZone: ZONE, models: false, yes: true }))).done, "configured")
  assert.deepEqual(readConfig(profile.dataDir), { ...before, models: false })
  unchanged()

  // --timezone changes config.json only, so it takes no --adopt and no other repository.
  await assert.rejects(setup(options(profile, { timeZone: ZONE, adopt: before.machine, yes: true })), {
    message: /^on a machine that is set up, --timezone changes config\.json only, and --adopt needs the history/,
  })
  await assert.rejects(
    setup(options(profile, { timeZone: ZONE, repository: "someone-else/someone-else", yes: true })),
    {
      message:
        /^this machine is set up for made-up-user\/made-up-user\. On a machine that is set up, --timezone changes config\.json only/,
    },
  )
  assert.deepEqual(readConfig(profile.dataDir), { ...before, models: false })
  unchanged()
})

test("the push is refused: exit 1 and the fix, gh auth setup-git; the clone is left clean", POSIX, () => {
  const profile = profileRepo({ readme: OWN, config: null })
  // Pushes go to a repository that does not exist, as a push GitHub turns away before it starts.
  onGitHub(profile.remote, { pushTo: pathToFileURL(join(scratch("nowhere"), "made-up-user.git")).href })
  const env = homeWith(DAYS)
  const args = ["setup", "--data-dir", profile.dataDir, "--repo", USER, "--timezone", ZONE, "--yes"]
  const log = profile.log()

  const refused = cli(args, env)
  assert.equal(refused.status, 1)
  assert.equal(refused.stdout, "")
  assert.match(
    refused.stderr,
    /^token-heatmap: the push to made-up-user\/made-up-user was refused, so nothing was published\. git push failed: fatal: '[^']*made-up-user\.git' does not appear to be a git repository\n/,
  )
  assert.ok(
    refused.stderr.endsWith(
      "\nTo fix it, run `gh auth setup-git`, so that git signs in to github.com with your GitHub CLI login, then run setup again.\n",
    ),
    refused.stderr,
  )
  assert.deepEqual(profile.log(), log)
  assertClean(profile)
  assert.equal(existsSync(join(profile.clone, "token-heatmap")), false)
  assert.equal(existsSync(configPath(profile.dataDir)), false)

  // Once git can push, the same command goes through.
  onGitHub(profile.remote)
  const fixed = cli(args, env)
  assert.equal(fixed.status, 0, fixed.stderr)
  assert.deepEqual(profile.log()[0].files, FIRST_COMMIT)
  assert.ok(existsSync(configPath(profile.dataDir)))
})

// ---------------------------------------------------------------------------------------------
// More of what setup promises
// ---------------------------------------------------------------------------------------------

test(
  "a push the remote turns down, as on a protected branch: setup says so, and leaves the clone clean",
  POSIX,
  async () => {
    const profile = profileRepo({ readme: OWN, config: null })
    onGitHub(profile.remote)
    const hook = join(profile.remote, "hooks", "pre-receive")
    writeFileSync(hook, "#!/bin/sh\necho 'protected branch hook declined' >&2\nexit 1\n")
    chmodSync(hook, 0o755)
    await assert.rejects(setUp(profile), (error: Error) => {
      assert.match(
        error.message,
        /^the push to made-up-user\/made-up-user was refused, so nothing was published\. git push failed: /,
      )
      assert.match(error.message, /\n!\tHEAD:refs\/heads\/main\t\[remote rejected\] \(pre-receive hook declined\)\n/)
      assert.ok(
        error.message.endsWith(
          "\nGitHub turned the commit down, as it does on a protected branch: let your account push to the default branch of made-up-user/made-up-user, then run setup again.",
        ),
        error.message,
      )
      assert.doesNotMatch(error.message, /gh auth setup-git/)
      return true
    })
    assert.equal(profile.log().length, 1)
    assertClean(profile)
    assert.equal(existsSync(configPath(profile.dataDir)), false)
  },
)

test("a profile repository with no README.md: setup writes one, with the markers and the block", async () => {
  const profile = profileRepo({ readme: null, config: null })
  onGitHub(profile.remote)
  assert.equal((await setUp(profile)).done, "pushed")
  const history = profile.file(HISTORY) ?? ""
  assert.equal(profile.file("README.md"), `${START}\n${render(parseHistory(history), TODAY)}\n${END}\n`)
  assert.equal(profile.file("LICENSE"), "Made-up license text.\n")
  assert.deepEqual(profile.log()[0].files, FIRST_COMMIT)
})

test("a README with one marker and not the other: setup stops, and publishes nothing", async () => {
  const readme = `${OWN}\n${START}\nMy own text below the marker.\n`
  const profile = profileRepo({ readme, config: null })
  onGitHub(profile.remote)
  await assert.rejects(setUp(profile), {
    name: "MarkersError",
    message:
      /^README\.md has a "<!-- token-heatmap:start -->" line with no "<!-- token-heatmap:end -->" line after it\./,
  })
  assert.equal(profile.log().length, 1)
  assert.equal(profile.file("README.md"), readme)
  assertClean(profile)
  assert.equal(existsSync(configPath(profile.dataDir)), false)
})

test("over SSH when the HTTPS clone is refused; a push refused there names the SSH fix too", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  const { https, ssh } = addresses(REPOSITORY)
  onGitHub(profile.remote, { https: false, pushTo: pathToFileURL(join(scratch("nowhere"), "x.git")).href })
  await assert.rejects(setUp(profile), (error: Error) => {
    assert.ok(
      error.message.endsWith(
        "\nTo fix it, run `gh auth setup-git`, so that git signs in to github.com with your GitHub CLI login, then run setup again.\n" +
          "This clone reaches GitHub over SSH, which that does not change: load your key with `ssh-add`, or switch the clone " +
          `to HTTPS first with \`git -C "${profile.clone}" remote set-url origin ${https}\`.`,
      ),
      error.message,
    )
    return true
  })
  assert.equal(git(profile.clone, ["config", "--get", "remote.origin.url"]).trim(), ssh)

  onGitHub(profile.remote, { https: false })
  assert.equal((await setUp(profile)).done, "pushed")
  assert.equal(git(profile.clone, ["config", "--get", "remote.origin.url"]).trim(), ssh)
  assert.deepEqual(profile.log()[0].files, FIRST_COMMIT)
})

test("a repository that cannot be cloned at all, or has no commits: setup says what to do, and leaves no clone", async () => {
  const dataDir = scratch("data")
  const profile = profileRepo({ config: null })
  const opts = (): SetupOptions => ({ ...options(profile, { timeZone: ZONE, yes: true }), dataDir })
  onGitHub()
  await assert.rejects(setup(opts()), {
    message:
      "cannot clone github.com/made-up-user/made-up-user, over HTTPS or SSH. A profile README lives in a public repository " +
      "named after the user, USER/USER: check that it exists. Git said:\n" +
      "https://github.com/made-up-user/made-up-user.git: fatal: transport 'https' not allowed\n" +
      "git@github.com:made-up-user/made-up-user.git: fatal: transport 'ssh' not allowed",
  })
  assert.deepEqual(readdirSync(dataDir), [])

  const empty = join(scratch("empty"), "made-up-user.git")
  git(scratch(), ["init", "--quiet", "--bare", "--initial-branch=main", empty])
  onGitHub(empty)
  await assert.rejects(setup(opts()), {
    message:
      "github.com/made-up-user/made-up-user has no commits yet. Add a README.md to it on GitHub, then run setup again",
  })
  assert.deepEqual(readdirSync(dataDir), [])
})

test("repo/ in the data dir that is not setup's clone: setup stops and removes nothing; an empty one, or a clone of the old repository, is replaced", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  onGitHub(profile.remote)
  mkdirSync(profile.clone)
  writeFileSync(join(profile.clone, "mine.txt"), "Mine.\n")
  await assert.rejects(setUp(profile), {
    message: `${profile.clone} is in the way: token-heatmap keeps its clone of made-up-user/made-up-user there, and that is something else. Move it away, then run setup again`,
  })
  assert.equal(readFileSync(join(profile.clone, "mine.txt"), "utf8"), "Mine.\n")

  // An empty directory holds nothing of anyone's, so setup clones there.
  const empty = profileRepo({ readme: OWN, config: null })
  mkdirSync(empty.clone)
  onGitHub(empty.remote)
  assert.equal((await setUp(empty)).done, "pushed")
  assertClean(empty)

  // A data dir set up for another profile repository: its clone is setup's own, so it goes, and the machine id stays.
  const moved = profileRepo({ readme: OWN, config: null })
  const old: Config = { ...CONFIG, repository: "old-name/old-name", machine: "m0v3d1" }
  writeConfig(moved.dataDir, old)
  git(moved.dataDir, ["clone", "--quiet", "--depth", "1", pathToFileURL(moved.remote).href, "repo"])
  git(moved.clone, ["remote", "set-url", "origin", addresses(old.repository).https])
  onGitHub(moved.remote)
  const plan = await setup(options(moved))
  assert.match(
    plan.text,
    /^ {2}Repository {3}github\.com\/made-up-user\/made-up-user, its default branch, in place of old-name\/old-name$/m,
  )
  assert.equal((await setup(options(moved, { yes: true }))).done, "pushed")
  assert.deepEqual(readConfig(moved.dataDir), { ...old, repository: REPOSITORY })
  assert.equal(git(moved.clone, ["config", "--get", "remote.origin.url"]).trim(), addresses(REPOSITORY).https)
  assert.equal(moved.file(HISTORY), linesFor("m0v3d1"))
})

// ---------------------------------------------------------------------------------------------
// config.json and --repo
// ---------------------------------------------------------------------------------------------

test("config.json: written whole and read back, with a new random machine id each setup", () => {
  const dataDir = join(scratch("data"), "made", "here")
  writeConfig(dataDir, CONFIG)
  assert.equal(readFileSync(configPath(dataDir), "utf8"), `${JSON.stringify(CONFIG, null, 2)}\n`)
  assert.deepEqual(readConfig(dataDir), CONFIG)
  assert.deepEqual(readdirSync(dataDir), ["config.json"])
  assert.throws(() => writeConfig(dataDir, { ...CONFIG, machine: "Not An Id" }), {
    name: "ConfigError",
    message: "config.json not written: machine is not an id of lowercase letters and digits",
  })
  assert.deepEqual(readConfig(dataDir), CONFIG)

  const ids = new Set(Array.from({ length: 50 }, newMachineId))
  for (const id of ids) assert.match(id, /^[a-z0-9]{6}$/)
  assert.ok(ids.size > 45, "ids are random")
})

test("a config.json that cannot be read stops setup, and says what to do", async () => {
  const profile = profileRepo({ readme: OWN, config: null })
  writeFileSync(configPath(profile.dataDir), '{"repository":"made-up-user/made-up-user"}\n')
  await assert.rejects(setup(options(profile)), {
    message: `${configPath(profile.dataDir)}: timeZone is not an IANA time zone such as America/Los_Angeles. Fix it, or delete it to set this machine up anew; its lines in history.jsonl can then be taken over with --adopt ID`,
  })
})

test("--repo takes a GitHub user name, or USER/USER", () => {
  assert.equal(profileRepository("made-up-user"), "made-up-user/made-up-user")
  assert.equal(profileRepository("Made-Up-User/made-up-user"), "Made-Up-User/Made-Up-User")
  for (const arg of ["", "someone/else", "a/a/a", "made up", "made_up", "x".repeat(40), "../etc"]) {
    assert.equal(profileRepository(arg), undefined, arg)
  }
})

// ---------------------------------------------------------------------------------------------
// The command line: plugin/bin/token-heatmap, and the bundle `npm run check` builds first
// ---------------------------------------------------------------------------------------------

test(
  "setup prints the plan and then publishes; CLAUDE_PLUGIN_DATA stands in for --data-dir, and the zone is this machine's",
  POSIX,
  () => {
    const profile = profileRepo({ config: null })
    onGitHub(profile.remote)
    const zone = "Pacific/Kiritimati" // 14 hours ahead of UTC
    const env = { ...homeWith(DAYS), TZ: zone, CLAUDE_PLUGIN_DATA: profile.dataDir }
    const today = () => localDate(new Date(), zone)

    const plan = cli(["setup", "--repo", USER], env)
    assert.deepEqual([plan.status, plan.stderr], [0, ""])
    assert.match(plan.stdout, /^token-heatmap setup: the plan\. Nothing has changed yet\.\n/)
    assert.match(plan.stdout, /^ {2}Time zone {4}Pacific\/Kiritimati: /m)
    assert.match(plan.stdout, /^ {2}Days found {3}2 days with usage, 2026-11-12 to 2026-11-13$/m)
    assert.match(plan.stdout, /^ {2}Model names {2}claude-opus-5-5, claude-sonnet-5-5$/m)
    assert.deepEqual(readdirSync(profile.dataDir), [])
    assert.equal(profile.log().length, 1)

    const before = today()
    const done = cli(["setup", "--repo", USER, "--yes"], env)
    assert.deepEqual([done.status, done.stderr], [0, ""])
    assert.match(
      done.stdout,
      /^Pushed one commit by token-heatmap\[bot\] to github\.com\/made-up-user\/made-up-user\. /,
    )
    const config = readConfig(profile.dataDir)
    assert.deepEqual(config, { repository: REPOSITORY, timeZone: zone, machine: config.machine, models: true })
    const history = profile.file(HISTORY) ?? ""
    assert.deepEqual(
      parseHistory(history).map((line) => line.date),
      ["2026-11-12", "2026-11-13"],
    )
    // README already has the markers, so the block goes between them and nothing is added.
    assert.ok(
      [before, today()].some(
        (day) =>
          profile.file("README.md") ===
          README.replace(`${START}\n${END}`, `${START}\n${render(parseHistory(history), day)}\n${END}`),
      ),
      "the grid ends on today in the configured zone",
    )
  },
)

test("setup: a command line that cannot run exits 2 and changes nothing", POSIX, () => {
  const env = homeWith(DAYS)
  const dataDir = scratch("data")
  const at = ["setup", "--data-dir", dataDir]
  const cases: [string[], string][] = [
    [["setup", "--repo", USER], "setup needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set"],
    [at, "setup needs --repo USER, your GitHub user name"],
    [[...at, "--repo"], "Option '--repo <value>' argument missing"],
    [[...at, "--repo", "someone/else"], '--repo takes your GitHub user name, such as octocat, not "someone/else"'],
    [
      [...at, "--repo", USER, "--timezone", "Mars/Olympus_Mons"],
      '--timezone takes an IANA time zone such as America/Los_Angeles, not "Mars/Olympus_Mons"',
    ],
    [[...at, "--repo", USER, "--models", "--no-models"], "--models and --no-models do not go together"],
    [
      [...at, "--repo", USER, "--adopt", "P7M2X1"],
      '--adopt takes a machine id of lowercase letters and digits, not "P7M2X1"',
    ],
    [[...at, "--repo", USER, "--force"], "Unknown option '--force'"],
    [[...at, "--repo", USER, "now"], "Unexpected argument 'now'. This command does not take positional arguments"],
  ]
  for (const [args, reason] of cases) {
    const { status, stdout, stderr } = cli(args, env)
    assert.equal(status, 2, args.join(" "))
    assert.equal(stdout, "")
    assert.ok(stderr.startsWith(`token-heatmap: ${reason}\n\nusage: token-heatmap render`), stderr)
  }
  assert.deepEqual(readdirSync(dataDir), [])
})
