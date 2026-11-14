// One sync: collect every provider's days, then publish them with the block they make.
//
//   records = each provider's collect(zone)                 # before the fetch: the slow part
//   publish(update)
//     history = merge(the remote's history.jsonl, records)   # a recorded day never goes down
//     block   = render(history, today in zone)
//     readme  = the remote's README.md, its block replaced   # markers missing: nothing is written
//
// setup runs the same steps, with its own update: see setup.ts.
//
// runSync wraps one sync for the command line and the hooks:
//
//   another sync holds sync.lock: stop                      # see state.ts
//   a hook's sync, under 60 minutes after the last (5 for SessionEnd): count the skip, stop
//   sync, then write its time, trigger and result or error to state.json

import { readConfig } from "./config.ts"
import type { DayRecord, HistoryLine, Provider } from "./providers/provider.ts"
import { type Files, PushError, publish } from "./publish/git-readme.ts"
import { replaceBlock } from "./readme.ts"
import { render } from "./render.ts"
import { nextAllowed, readState, type Trigger, takeLock, withResult, withSkip, writeState } from "./state.ts"
import { formatHistory, localDate, merge, parseHistory } from "./store.ts"

/** How a run of runSync ended, when it did not throw. */
export type Outcome = "pushed" | "unchanged" | "locked" | "limited"

/**
 * One sync under <dataDir>/sync.lock, its result written to state.json. "locked" when another
 * sync holds the lock, which writes nothing. With a `trigger`, "limited" when the last sync was
 * too recent: the skip is counted in state.json. An error is written there, then thrown.
 */
export async function runSync(opts: {
  dataDir: string
  providers: readonly Provider[]
  now: Date
  trigger?: Trigger
}): Promise<Outcome> {
  const { dataDir, now } = opts
  const trigger = opts.trigger ?? null
  const lock = takeLock(dataDir, now)
  if (lock === undefined) return "locked"
  try {
    const state = readState(dataDir)
    if (trigger !== null && nextAllowed(state, trigger, now) !== undefined) {
      writeState(dataDir, withSkip(state, trigger, now))
      return "limited"
    }
    let result: "pushed" | "unchanged"
    try {
      result = await sync(opts)
    } catch (error) {
      writeState(dataDir, withResult(state, { now, trigger, error: errorText(error) }))
      throw error
    }
    writeState(dataDir, withResult(state, { now, trigger, result }))
    return result
  } finally {
    lock.release()
  }
}

/**
 * An error as state.json keeps it: on one line, as status prints it, and a refused sign-in gets
 * the fix that setup prints.
 */
export function errorText(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()
  if (error instanceof PushError && !error.declined) {
    return `${message.replace(/\.$/, "")}. If git could not sign in, run \`gh auth setup-git\`; the next sync tries again`
  }
  return message
}

/**
 * The environment of a sync that runs detached, where nobody can answer a prompt: git asks no
 * terminal, Git Credential Manager asks nothing, and an askpass, git's or ssh's, fails at once
 * instead of opening a window. So a push that needs a password fails, and the error is recorded.
 */
export function detachedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const fail = process.platform === "win32" ? "token-heatmap-no-askpass" : "false"
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: fail,
    SSH_ASKPASS: fail,
    SSH_ASKPASS_REQUIRE: "never",
  }
}

/**
 * Collects from `providers` with the zone in <dataDir>/config.json, merges the days into the
 * profile repository's history.jsonl as this machine's lines, rebuilds the block for the day
 * `now` falls on, and pushes both files in one commit when either changed.
 */
export async function sync(opts: {
  dataDir: string
  providers: readonly Provider[]
  now: Date
}): Promise<"pushed" | "unchanged"> {
  const config = readConfig(opts.dataDir)
  const collected = await collect(opts.providers, config.timeZone)
  const records = config.models ? collected : withoutModels(collected)
  const today = localDate(opts.now, config.timeZone)

  return publish(opts.dataDir, (current) =>
    nextFiles({
      history: readHistory(current.history, config.repository),
      readme: current.readme,
      records,
      machine: config.machine,
      today,
    }),
  )
}

/** Every provider's days in `timeZone`, in the providers' order. A day must carry its provider's own id. */
export async function collect(providers: readonly Provider[], timeZone: string): Promise<DayRecord[]> {
  const records: DayRecord[] = []
  for (const provider of providers) {
    for (const record of await provider.collect({ timeZone })) {
      if (record.provider !== provider.id) {
        throw new Error(`provider ${provider.id} returned a day of ${JSON.stringify(record.provider)}`)
      }
      records.push(record)
    }
  }
  return records
}

/** The records without the split by model, as `"models": false` publishes them: a line holds only `tokens`. */
export const withoutModels = (records: readonly DayRecord[]): DayRecord[] =>
  records.map(({ date, provider, tokens }) => ({ date, provider, tokens }))

/** The profile repository's history.jsonl, read. A line it cannot read throws, naming the repository. */
export function readHistory(text: string, repository: string): HistoryLine[] {
  try {
    return parseHistory(text)
  } catch (error) {
    throw new Error(`token-heatmap/history.jsonl in ${repository}: ${(error as Error).message}`)
  }
}

/**
 * The two files to publish: `history` with `records` merged in as `machine`'s lines, and
 * `readme` with its block drawn again for `today`. Throws a MarkersError when the README has no
 * markers, and an error when the merged history would not read back.
 */
export function nextFiles(o: {
  history: readonly HistoryLine[]
  readme: string
  records: readonly DayRecord[]
  machine: string
  today: string
}): Files {
  const history = merge(o.history, o.records, o.machine)
  const text = formatHistory(history)
  try {
    parseHistory(text) // what a provider returned must read back, or the next sync would stop here
  } catch (error) {
    throw new Error(`the history to publish cannot be read back: ${(error as Error).message}`)
  }
  return { history: text, readme: replaceBlock(o.readme, render(history, o.today)) }
}
