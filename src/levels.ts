// Five levels: 0 for a day with no usage, 1 to 4 by quartile of the days with usage. The
// cut-offs use rank, so one huge day does not push the other days down into level 1.

export type Level = 0 | 1 | 2 | 3 | 4

/** The 25th, 50th and 75th percentile of the totals above 0, by rank. None when no day has usage. */
export function cutoffs(totals: readonly number[]): number[] {
  const active = totals.filter((t) => t > 0).sort((a, b) => a - b)
  if (active.length === 0) return []
  const at = (p: number) => active[Math.max(0, Math.ceil(p * active.length) - 1)]
  return [at(0.25), at(0.5), at(0.75)]
}

/** A level for each total. Any usage is at least level 1, and a total above a cut-off is one level up. */
export function levels(totals: readonly number[]): Level[] {
  const cuts = cutoffs(totals)
  return totals.map((t) => (t > 0 ? ((1 + cuts.filter((c) => t > c).length) as Level) : 0))
}
