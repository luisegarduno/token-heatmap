// What may leave the machine, and nothing else: the keys of a history.jsonl line, the four counts
// in each `tokens` and each model's counts, and model names that match the rule or read "other".
//
// test/published-fields.test.ts checks that a sync and a setup publish nothing beyond these, and
// test/docs.test.ts that README.md lists exactly these. A change here is a change to what users
// publish, so it goes with a change to the README's "What leaves your machine".

/** The keys of a history.jsonl line, in the order a line writes them. `models` is left out with `--no-models`. */
export const LINE_KEYS = ["date", "provider", "machine", "tokens", "models"] as const

/** The keys of `tokens` and of each model's counts, in the order a line writes them. */
export const COUNT_KEYS = ["input", "output", "cache_write", "cache_read"] as const

/** The rule for a published model name, written out here, not imported, so that the tests check the collector. */
export const MODEL_RULE = /^[A-Za-z0-9._:@-]{1,64}$/

/** Where the counts of a model whose name breaks the rule go. */
export const OTHER_MODEL = "other"
