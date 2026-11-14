# Providers

A provider is the collector for one AI tool. It reads what that tool records on the user's machine and returns per-day token counts in a common shape. It is the only part of token-heatmap that knows a particular tool: storing the history (`src/store.ts`), drawing the heatmap (`src/render.ts`) and publishing it (`src/publish/git-readme.ts`) work on the common shape alone.

v1 has one provider, Claude Code, in [`src/providers/claude-code.ts`](../src/providers/claude-code.ts).

## The interface

The types are in [`src/providers/provider.ts`](../src/providers/provider.ts), and the list of providers that sync and setup collect from is in [`src/providers/index.ts`](../src/providers/index.ts).

```ts
/** Token counts by type. Every count is a whole number, 0 or more. */
type Tokens = { input: number; output: number; cache_write: number; cache_read: number }

/** One day of one provider, as a collector reports it. */
type DayRecord = {
  /** YYYY-MM-DD in the configured time zone. */
  date: string
  provider: string
  /** The sum of `models`. */
  tokens: Tokens
  /** By model name. Left out with `setup --no-models`. */
  models?: Record<string, Tokens>
}

/** One line of history.jsonl: a day of one provider on one machine. */
type HistoryLine = DayRecord & { machine: string }

interface Provider {
  /** For example "claude-code". */
  id: string
  /** A full total for every day still in the provider's own data. */
  collect(opts: { timeZone: string }): Promise<DayRecord[]>
}
```

`provider.ts` also exports `TOKEN_TYPES`, `NO_TOKENS`, `addTokens` and `totalOf` for adding counts up.

## What a provider must do

- **Use a fixed `id`.** It is written as `provider` on every history line, and a line is kept per day, provider and machine. Once released, an id never changes. Every record a provider returns carries its own `id`: sync stops with an error otherwise.
- **Return full totals, not what is new.** `collect` returns every day it can still see, each with that day's whole count. It keeps no cursor and no state between runs. The store keeps the higher of the recorded count and the new one, model by model, so a day never goes down when the tool deletes its old data, and a count that is reported twice is not added twice.
- **Count each unit of usage once.** Find out how the tool repeats itself (the same response on several lines, copies made by a resume or a fork) and count each response once. The Claude Code collector keeps the largest usage per `message.id` and `requestId`.
- **Put each response on a day in `timeZone`.** `timeZone` is an IANA zone, such as `Europe/Berlin`. `localDate(instant, timeZone)` in `src/store.ts` gives the YYYY-MM-DD.
- **Map the tool's counts onto the four types.** Input, output, tokens written to the prompt cache, tokens read from it. A type the tool does not report is 0. Every count is a safe whole number, 0 or more.
- **Make `tokens` the sum of `models`.** Return `models` whenever the tool names its models. Sync takes the split out itself for a machine set up with `--no-models`, so a provider never reads that setting.
- **Publish only model names that match the rule.** A name goes out as the tool records it only when it matches `^[A-Za-z0-9._:@-]{1,64}$`. Any other name, or none, counts under `other`. A model name is the one free-text field that leaves the machine, so the rule keeps out what can hide in one: a cloud resource address with an account number, markup, a path.
- **Return nothing else.** No prompts, file paths, project names, session ids or times of day. The history format has no place for them, and `parseHistory` rejects a line with any other key.
- **Read local files only.** No network, no prompt, nothing written. `collect` runs in a detached process at most once an hour, and in the foreground during setup, so it must not wait on anyone.
- **Get through the tool's mess.** A data directory that does not exist holds no usage. A half-written last line, a line that is not JSON, or a file deleted while it is read is skipped, and the sync goes on. Any other error stops it, and the error is recorded for `/token-heatmap:status`.
- **Stay fast.** The Claude Code collector reads 3 GB of transcripts in about 5 seconds by streaming each file and parsing only the lines that can carry usage.

## Adding one

1. **Write the collector** in `src/providers/<tool>.ts`. Export a function that returns a `Provider`, and let it take the directory to read, so that tests can point it at made-up data:

   ```ts
   import type { DayRecord, Provider } from "./provider.ts"

   export function exampleTool(opts: { root?: string } = {}): Provider {
     return {
       id: "example-tool",
       async collect({ timeZone }) {
         const root = opts.root ?? defaultRoot() // where the tool keeps its data, honouring its own settings
         const records: DayRecord[] = []
         // read the files under root, count each response once, add it to its day and model
         return records
       },
     }
   }
   ```

2. **Add it to the list** in `src/providers/index.ts`:

   ```ts
   export const providers: readonly Provider[] = [claudeCode(), exampleTool()]
   ```

3. **Test it** in `test/<tool>.test.ts` with data written inline in the test, never copied from a real machine. Give each shape of the tool's data its own test, as `test/claude-code.test.ts` does: one response repeated, a copy in another file, a model name that breaks the rule, a line on each side of midnight, a broken line, a missing directory. `test/helpers.ts` gives every test an empty temporary home directory, so a collector that falls back to the real one finds nothing.

4. **Plant strings for it** in `test/published-fields.test.ts`: whatever the tool records that must not leave the machine. The test syncs the made-up data into a repository on disk and fails if any of it is found there.

5. **Document it.** Add the new `provider` value to "What leaves your machine" in the README, a line under "Unreleased" in `CHANGELOG.md`, and the tool's data directory to the README's "How it works".

6. **Rebuild the bundle** with `npm run build`, and commit `plugin/dist/cli.mjs` with the change. `npm run check` fails until the committed bundle matches the source.

`test/sync.test.ts` has a test with a fake second provider whose days reach the heatmap through the same store, renderer and publisher. A new provider needs no change in those three.

## What a second provider changes on the profile

The heatmap adds every provider's days together: each day's square and tooltip, and the year's total. Two things in v1 still say Claude Code, and change when a second provider ships:

- The heatmap's total line reads "N Claude Code tokens in the last year", in `src/render.ts`.
- The README's "What leaves your machine" lists `claude-code` as the only `provider` value.

A per-provider view is planned for later. The history keeps each provider's lines apart, so it needs no change to the format.
