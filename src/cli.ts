// token-heatmap's command line. plugin/bin/token-heatmap runs the bundle of this file.
//
//   token-heatmap render --history FILE [--today YYYY-MM-DD]
//   token-heatmap sync --foreground [--data-dir DIR]
//   token-heatmap setup --repo USER [--data-dir DIR] [--timezone ZONE] [--models | --no-models] [--adopt ID] [--yes]
//
// Exit codes: 0 done, 1 failed, 2 the command line was wrong.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { isTimeZone, MACHINE_ID } from "./config.ts"
import { providers } from "./providers/index.ts"
import { render } from "./render.ts"
import { profileRepository, setup } from "./setup.ts"
import { isDate, parseHistory } from "./store.ts"
import { sync } from "./sync.ts"

const USAGE = `usage: token-heatmap render --history FILE [--today YYYY-MM-DD]
       token-heatmap sync --foreground [--data-dir DIR]
       token-heatmap setup --repo USER [--data-dir DIR] [--timezone ZONE] [--models | --no-models]
                           [--adopt ID] [--yes]

commands:
  render    print the README block for a history file
            --history FILE   the history.jsonl to draw
            --today DATE     the grid's last day; defaults to today on this machine
  sync      count the transcripts, then push the history and the block to the profile
            repository in one commit if a number changed; prints "pushed" or "unchanged"
            --foreground     run in this process, until the push is done
            --data-dir DIR   config.json and the clone; defaults to $CLAUDE_PLUGIN_DATA
  setup     put the block on the profile README of github.com/USER/USER. Without --yes it prints
            the plan, model names to be published included, and changes nothing
            --repo USER        your GitHub user name: the profile repository is USER/USER
            --data-dir DIR     where config.json and the clone go; defaults to $CLAUDE_PLUGIN_DATA
            --timezone ZONE    the IANA zone that decides each day, such as America/Los_Angeles;
                               defaults to this machine's. On a machine that is set up, it changes
                               config.json only, and the days already recorded stay as they are
            --no-models        publish each day's counts by type only, with no model names. Later
                               runs keep the choice; --models publishes the names again
            --adopt ID         go on as machine ID, whose lines the history holds from an earlier
                               install
            --yes              clone, push one commit by token-heatmap[bot], write config.json
`

/** The block's images: the bundle is plugin/dist/cli.mjs, and the images are in plugin/assets. */
const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url))

/** A command line that cannot run. It exits 2, with the usage. */
class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case "render":
      return renderCommand(rest)
    case "sync":
      return syncCommand(rest)
    case "setup":
      return setupCommand(rest)
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE)
      return 0
    case undefined:
      throw new UsageError("no command given")
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}`)
  }
}

function renderCommand(args: string[]): number {
  const { values } = asUsage(() =>
    parseArgs({ args, options: { history: { type: "string" }, today: { type: "string" } }, strict: true }),
  )
  if (values.history === undefined) throw new UsageError("render needs --history FILE")
  const today = values.today ?? localToday()
  if (!isDate(today)) throw new UsageError(`--today takes a day written YYYY-MM-DD, such as 2026-11-13, not ${today}`)

  let text: string
  try {
    text = readFileSync(values.history, "utf8")
  } catch (error) {
    throw new Error(`cannot read ${values.history}: ${messageOf(error)}`)
  }
  let history: ReturnType<typeof parseHistory>
  try {
    history = parseHistory(text)
  } catch (error) {
    throw new Error(`${values.history}: ${messageOf(error)}`)
  }
  process.stdout.write(`${render(history, today)}\n`)
  return 0
}

async function syncCommand(args: string[]): Promise<number> {
  const { values } = asUsage(() =>
    parseArgs({ args, options: { foreground: { type: "boolean" }, "data-dir": { type: "string" } }, strict: true }),
  )
  // The hooks are to run sync without --foreground, so that it hands the work to a detached copy
  // of itself. Until that exists, sync runs only in the foreground, and says so.
  if (!values.foreground) throw new UsageError("sync runs only with --foreground for now")
  const dataDir = values["data-dir"] ?? process.env.CLAUDE_PLUGIN_DATA
  if (!dataDir) throw new UsageError("sync needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set")

  process.stdout.write(`${await sync({ dataDir, providers, now: new Date() })}\n`)
  return 0
}

async function setupCommand(args: string[]): Promise<number> {
  const { values } = asUsage(() =>
    parseArgs({
      args,
      options: {
        repo: { type: "string" },
        "data-dir": { type: "string" },
        timezone: { type: "string" },
        models: { type: "boolean" },
        "no-models": { type: "boolean" },
        adopt: { type: "string" },
        yes: { type: "boolean" },
      },
      strict: true,
    }),
  )
  const dataDir = values["data-dir"] ?? process.env.CLAUDE_PLUGIN_DATA
  if (!dataDir) throw new UsageError("setup needs --data-dir DIR, or CLAUDE_PLUGIN_DATA set")
  if (values.repo === undefined) throw new UsageError("setup needs --repo USER, your GitHub user name")
  const repository = profileRepository(values.repo)
  if (!repository) {
    throw new UsageError(`--repo takes your GitHub user name, such as octocat, not ${JSON.stringify(values.repo)}`)
  }
  if (values.timezone !== undefined && !isTimeZone(values.timezone)) {
    throw new UsageError(
      `--timezone takes an IANA time zone such as America/Los_Angeles, not ${JSON.stringify(values.timezone)}`,
    )
  }
  if (values.models && values["no-models"]) throw new UsageError("--models and --no-models do not go together")
  if (values.adopt !== undefined && !MACHINE_ID.test(values.adopt)) {
    throw new UsageError(
      `--adopt takes a machine id of lowercase letters and digits, not ${JSON.stringify(values.adopt)}`,
    )
  }

  const report = await setup({
    dataDir,
    repository,
    timeZone: values.timezone,
    models: values["no-models"] ? false : values.models ? true : undefined,
    adopt: values.adopt,
    yes: values.yes ?? false,
    providers,
    now: new Date(),
    assets: ASSETS,
  })
  process.stdout.write(report.text)
  return 0
}

/** Runs `read`, and turns what it throws into a UsageError: parseArgs throws on an unknown option. */
function asUsage<T>(read: () => T): T {
  try {
    return read()
  } catch (error) {
    throw new UsageError(messageOf(error))
  }
}

/** Today's date in this machine's time zone. */
function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The process ends by itself once stdout is flushed. process.exit() here could cut off a long
// block written to a pipe, which is asynchronous on macOS.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`token-heatmap: ${error.message}\n\n${USAGE}`)
      process.exitCode = 2
    } else {
      process.stderr.write(`token-heatmap: ${messageOf(error)}\n`)
      process.exitCode = 1
    }
  },
)
