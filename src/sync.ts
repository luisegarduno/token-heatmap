// One sync: collect every provider's days, then publish them with the block they make.
//
//   records = each provider's collect(zone)                 # before the fetch: the slow part
//   publish(update)
//     history = merge(the remote's history.jsonl, records)   # a recorded day never goes down
//     block   = render(history, today in zone)
//     readme  = the remote's README.md, its block replaced   # markers missing: nothing is written

import { readConfig } from "./config.ts"
import type { DayRecord, Provider } from "./providers/provider.ts"
import { publish } from "./publish/git-readme.ts"
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
  const records: DayRecord[] = []
  for (const provider of opts.providers) {
    for (const record of await provider.collect({ timeZone: config.timeZone })) {
      if (record.provider !== provider.id) {
        throw new Error(`provider ${provider.id} returned a day of ${JSON.stringify(record.provider)}`)
      }
      // Without the split by model, a line holds only `tokens`.
      records.push(config.models ? record : { date: record.date, provider: record.provider, tokens: record.tokens })
    }
  }
  const today = localDate(opts.now, config.timeZone)

  return publish(opts.dataDir, (current) => {
    let history: ReturnType<typeof parseHistory>
    try {
      history = merge(parseHistory(current.history), records, config.machine)
    } catch (error) {
      throw new Error(`token-heatmap/history.jsonl in ${config.repository}: ${(error as Error).message}`)
    }
    const text = formatHistory(history)
    try {
      parseHistory(text) // what a provider returned must read back, or the next sync would stop here
    } catch (error) {
      throw new Error(`the history to publish cannot be read back: ${(error as Error).message}`)
    }
    return { history: text, readme: replaceBlock(current.readme, render(history, today)) }
  })
}
