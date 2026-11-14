// One sync: collect every provider's days, then publish them with the block they make.
//
//   records = each provider's collect(zone)                 # before the fetch: the slow part
//   publish(update)
//     history = merge(the remote's history.jsonl, records)   # a recorded day never goes down
//     block   = render(history, today in zone)
//     readme  = the remote's README.md, its block replaced   # markers missing: nothing is written
//
// setup runs the same steps, with its own update: see setup.ts.

import { readConfig } from "./config.ts"
import type { DayRecord, HistoryLine, Provider } from "./providers/provider.ts"
import { type Files, publish } from "./publish/git-readme.ts"
import { replaceBlock } from "./readme.ts"
import { render } from "./render.ts"
import { formatHistory, localDate, merge, parseHistory } from "./store.ts"

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
