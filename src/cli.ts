// token-heatmap's command line. plugin/bin/token-heatmap runs the bundle of this file.
//
//   token-heatmap render --history FILE [--today YYYY-MM-DD]
//   token-heatmap sync --foreground [--data-dir DIR]
//
// Exit codes: 0 done, 1 failed, 2 the command line was wrong.

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { providers } from "./providers/index.ts"
import { render } from "./render.ts"
import { isDate, parseHistory } from "./store.ts"
import { sync } from "./sync.ts"

const USAGE = `usage: token-heatmap render --history FILE [--today YYYY-MM-DD]
       token-heatmap sync --foreground [--data-dir DIR]

commands:
  render    print the README block for a history file
            --history FILE   the history.jsonl to draw
            --today DATE     the grid's last day; defaults to today on this machine
  sync      count the transcripts, then push the history and the block to the profile
            repository in one commit if a number changed; prints "pushed" or "unchanged"
            --foreground     run in this process, until the push is done
            --data-dir DIR   config.json and the clone; defaults to $CLAUDE_PLUGIN_DATA
`

/** A command line that cannot run. It exits 2, with the usage. */
class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case "render":
      return renderCommand(rest)
    case "sync":
      return syncCommand(rest)
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
