// The common record. Collect is the only stage that knows a particular AI tool: each provider
// turns that tool's own data into DayRecords, and store, render and publish work on these
// types alone.

/** Token counts by type. Every count is a whole number, 0 or more. */
export type Tokens = { input: number; output: number; cache_write: number; cache_read: number }

/** The four types, in the order a history line writes them. */
export const TOKEN_TYPES = ["input", "output", "cache_write", "cache_read"] as const satisfies readonly (keyof Tokens)[]

/** One day of one provider, as a collector reports it. */
export type DayRecord = {
  /** YYYY-MM-DD in the configured time zone. */
  date: string
  provider: string
  /** The sum of `models`. */
  tokens: Tokens
  /** By model name. Left out with `setup --no-models`. */
  models?: Record<string, Tokens>
}

/** One line of history.jsonl: a day of one provider on one machine. */
export type HistoryLine = DayRecord & { machine: string }

export interface Provider {
  /** For example "claude-code". */
  id: string
  /** A full total for every day still in the provider's own data. */
  collect(opts: { timeZone: string }): Promise<DayRecord[]>
}
