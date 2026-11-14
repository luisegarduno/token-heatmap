// Runs plugin/bin/token-heatmap, so this tests the launcher and the committed bundle,
// plugin/dist/cli.mjs. `npm run check` builds the bundle before it runs the tests.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { render } from "../src/render.ts"
import { parseHistory } from "../src/store.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const LAUNCHER = join(ROOT, "plugin", "bin", "token-heatmap")
const FIXTURE = join("test", "fixtures", "history.jsonl")
const BLOCK = readFileSync(join(ROOT, "test", "fixtures", "block.html"), "utf8")
const POSIX = { skip: process.platform === "win32" ? "the sh launcher; Windows runs token-heatmap.cmd" : false }

const scratch = mkdtempSync(join(tmpdir(), "token-heatmap-cli-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { status, stdout, stderr } = spawnSync(LAUNCHER, args, { cwd: ROOT, env, encoding: "utf8" })
  return { status, stdout, stderr }
}

test("render prints block.html for the made-up year", POSIX, () => {
  assert.deepEqual(run(["render", "--history", FIXTURE, "--today", "2026-11-13"]), {
    status: 0,
    stdout: BLOCK,
    stderr: "",
  })
})

test("render without --today ends the grid on today in this machine's time zone", POSIX, () => {
  // A zone 14 hours ahead of UTC, so its date differs from UTC's for half of every day. The date
  // is read before and after the run, so a run across midnight still passes.
  const env = { ...process.env, TZ: "Pacific/Kiritimati" }
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: env.TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date())
    const part = (type: string) => parts.find((p) => p.type === type)?.value
    return `${part("year")}-${part("month")}-${part("day")}`
  }
  const before = today()
  const { status, stdout } = run(["render", "--history", FIXTURE], env)
  const history = parseHistory(readFileSync(join(ROOT, FIXTURE), "utf8"))
  assert.equal(status, 0)
  assert.ok([before, today()].some((day) => stdout === `${render(history, day)}\n`))
})

test("--help prints the usage", POSIX, () => {
  const { status, stdout } = run(["--help"])
  assert.equal(status, 0)
  assert.match(stdout, /^usage: token-heatmap render --history FILE \[--today YYYY-MM-DD\]\n/)
})

test("a command line that cannot run exits 2, says why, and prints the usage", POSIX, () => {
  const cases: [string[], string][] = [
    [[], "no command given"],
    [["draw"], 'unknown command "draw"'],
    [["render"], "render needs --history FILE"],
    [["render", "--history", FIXTURE, "--theme", "dark"], "Unknown option '--theme'"],
    [["render", "--history", FIXTURE, "extra"], "Unexpected argument 'extra'"],
    [["render", "--history", FIXTURE, "--today", "2026-11-31"], "--today takes a day written YYYY-MM-DD"],
  ]
  for (const [args, reason] of cases) {
    const { status, stdout, stderr } = run(args)
    assert.equal(status, 2, args.join(" "))
    assert.equal(stdout, "")
    assert.ok(stderr.startsWith(`token-heatmap: ${reason}`), stderr)
    assert.match(stderr, /\n\nusage: token-heatmap render/)
  }
})

test("a history file that cannot be read exits 1 and names the file", POSIX, () => {
  const missing = join(scratch, "missing.jsonl")
  const broken = join(scratch, "broken.jsonl")
  writeFileSync(broken, `${readFileSync(join(ROOT, FIXTURE), "utf8").split("\n")[0]}\n{"date":\n`)
  assert.deepEqual(run(["render", "--history", missing]), {
    status: 1,
    stdout: "",
    stderr: `token-heatmap: cannot read ${missing}: ENOENT: no such file or directory, open '${missing}'\n`,
  })
  assert.deepEqual(run(["render", "--history", broken]), {
    status: 1,
    stdout: "",
    stderr: `token-heatmap: ${broken}: line 2: not JSON\n`,
  })
})

test("with no node on PATH, the launcher says how to fix it and exits 127", POSIX, () => {
  const empty = mkdtempSync(join(scratch, "path-"))
  // The launcher is run by /bin/sh itself here, because PATH holds nothing to find it with.
  const { status, stdout, stderr } = spawnSync("/bin/sh", [LAUNCHER, "render"], {
    env: { PATH: empty },
    encoding: "utf8",
  })
  assert.equal(status, 127)
  assert.equal(stdout, "")
  assert.match(stderr, /^token-heatmap: node was not found on PATH\. Install Node\.js 20 or later /)
})

test("with a node older than 20 on PATH, the launcher names its version and exits 1", POSIX, () => {
  const bin = mkdtempSync(join(scratch, "path-"))
  writeFileSync(join(bin, "node"), "#!/bin/sh\necho v18.20.4\n")
  chmodSync(join(bin, "node"), 0o755)
  const { status, stdout, stderr } = spawnSync("/bin/sh", [LAUNCHER, "render"], {
    env: { PATH: bin },
    encoding: "utf8",
  })
  assert.equal(status, 1)
  assert.equal(stdout, "")
  assert.match(stderr, /^token-heatmap: the node on PATH is v18\.20\.4, and token-heatmap needs 20 or later\. Install /)
})

test("token-heatmap.cmd prints block.html for the made-up year", {
  skip: process.platform === "win32" ? false : "Windows only",
}, () => {
  const { status, stdout, stderr } = spawnSync(
    "cmd.exe",
    ["/d", "/c", `${LAUNCHER}.cmd`, "render", "--history", FIXTURE, "--today", "2026-11-13"],
    { cwd: ROOT, encoding: "utf8" },
  )
  assert.deepEqual({ status, stdout, stderr }, { status: 0, stdout: BLOCK, stderr: "" })
})
