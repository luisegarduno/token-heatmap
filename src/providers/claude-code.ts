// Claude Code's provider: daily token counts from the transcripts under ~/.claude/projects, or
// $CLAUDE_CONFIG_DIR/projects when that is set.
//
// Usage lives at `message.usage` on lines of type "assistant". Claude Code writes one such line
// per content block, so one API response appears on about three lines that repeat its
// `message.id`, `requestId` and usage; a resumed or forked session copies those lines into
// another file. A response is counted once, with the largest usage among its lines, on the local
// date of its earliest line and under the model its lines name.
//
//   <projects>/<project>/<session>.jsonl
//   <projects>/<project>/<session>/subagents/agent-<id>.jsonl
//
// The format has changed many times. Each shape below is counted as shown:
//
//   one response on several lines with the same usage          once
//   a subagent file from before 2.1.307, where output_tokens    once, with the largest
//     grows line by line
//   a response copied into another file by a resume or fork    once
//   no requestId                                                once per message.id and sessionId
//   model "<synthetic>"                                         not at all
//   cache_creation_input_tokens of 0 beside a filled            the object's two fields, as cache write
//     cache_creation object (before 2.1.152)
//   a model name outside MODEL_NAME                             under "other"
//   lines on both sides of midnight                             on the local date of the earliest line
//   a half-written last line, or a line that is not JSON        skipped, with no error
//
// Every *.jsonl file is read as a stream of bytes. A line is decoded and parsed only when it holds
// both `"usage"` and `"assistant"`, as every line that carries usage does; the rest, most of the
// bytes, are tool results and other records that are never turned into text.

import type { Dirent } from "node:fs"
import { open, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { localDate } from "../store.ts"
import { addTokens, type DayRecord, NO_TOKENS, type Provider, type Tokens, totalOf } from "./provider.ts"

export const CLAUDE_CODE = "claude-code"

/**
 * A model name that is published as the transcript records it. It keeps out a cloud resource
 * address, which can hold an account number: such a name, or none, counts under OTHER.
 */
export const MODEL_NAME = /^[A-Za-z0-9._:@-]{1,64}$/
export const OTHER = "other"

/** The model of the messages Claude Code makes up itself, such as an API error: no tokens of any model. */
const SYNTHETIC = "<synthetic>"

/** How much of a file one read takes. A line may be any number of reads long. */
export const CHUNK_SIZE = 1 << 20

/** One API response, from the lines that carry it. */
type Response = { model: string; usage: Tokens; first: number }

/**
 * The Claude Code provider. `root` is the projects directory to read. Unless it is given, each
 * collect reads $CLAUDE_CONFIG_DIR/projects, or ~/.claude/projects when the variable is unset or
 * empty. A missing directory holds no usage.
 */
export function claudeCode(opts: { root?: string } = {}): Provider {
  return {
    id: CLAUDE_CODE,
    async collect({ timeZone }) {
      const root = opts.root ?? projectsDir()
      const responses = new Map<string, Response>()
      const chunk = Buffer.allocUnsafe(CHUNK_SIZE)
      const count = (bytes: Buffer) => {
        const line = readAssistantLine(bytes)
        if (!line) return
        const seen = responses.get(line.key)
        if (!seen) {
          responses.set(line.key, { model: line.model, usage: line.usage, first: line.time })
          return
        }
        if (totalOf(line.usage) > totalOf(seen.usage)) seen.usage = line.usage
        if (line.time < seen.first) seen.first = line.time // the earliest line decides the day
      }
      for (const file of await transcriptFiles(root)) {
        try {
          await readLines(file, chunk, count)
        } catch (error) {
          if (!isGone(error)) throw error // Claude Code's cleanup deleted it after the walk listed it
        }
      }
      return days(responses.values(), timeZone)
    },
  }
}

/** $CLAUDE_CONFIG_DIR/projects, or ~/.claude/projects when the variable is unset or empty. */
function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects")
}

const isGone = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"

/**
 * Every *.jsonl file under `root`, at any depth, sorted. Symbolic links are not followed. A
 * directory that does not exist, or no longer does when the walk reaches it, holds no files.
 */
async function transcriptFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string) => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isGone(error)) return
      throw error
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path)
    }
  }
  await walk(root)
  return files.sort()
}

const NEWLINE = 0x0a

/**
 * Calls `onLine` with each line of `file`, without its "\n". A last line with no "\n" is a line
 * too. `chunk` is the buffer each read fills, and `onLine` gets a view into it, so it must be done
 * with the bytes when it returns. A line that runs past the read it began in is gathered in
 * pieces and joined once at its end, so no byte is copied more than twice, however long its line.
 */
export async function readLines(file: string, chunk: Buffer, onLine: (line: Buffer) => void): Promise<void> {
  const handle = await open(file, "r")
  try {
    let pending: Buffer[] = [] // the start of a line that began in an earlier read
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      const view = chunk.subarray(0, bytesRead)
      let start = 0
      for (let end = view.indexOf(NEWLINE); end >= 0; end = view.indexOf(NEWLINE, start)) {
        const rest = view.subarray(start, end)
        if (pending.length === 0) {
          onLine(rest)
        } else {
          pending.push(rest)
          onLine(Buffer.concat(pending))
          pending = []
        }
        start = end + 1
      }
      // A copy, because the next read overwrites the chunk.
      if (start < bytesRead) pending.push(Buffer.from(view.subarray(start)))
    }
    if (pending.length > 0) onLine(Buffer.concat(pending))
  } finally {
    await handle.close()
  }
}

// Claude Code writes each line with JSON.stringify, which escapes no letter, and a quote inside a
// string as \". So a line whose top-level "type" is "assistant" and that has a "usage" key holds
// these two byte strings, and a line that lacks either cannot carry usage.
const QUOTED_USAGE = Buffer.from('"usage"')
const QUOTED_ASSISTANT = Buffer.from('"assistant"')

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** A count that the API may leave out or send as null, both meaning 0. Anything else that is not a count: undefined. */
const optionalCount = (value: unknown): number | undefined =>
  value === undefined || value === null ? 0 : isCount(value) ? value : undefined

/** The response a transcript line carries usage for, or nothing for any other line. */
function readAssistantLine(bytes: Buffer): { key: string; model: string; usage: Tokens; time: number } | undefined {
  if (bytes.indexOf(QUOTED_USAGE) < 0 || bytes.indexOf(QUOTED_ASSISTANT) < 0) return undefined
  let value: unknown
  try {
    // toString throws too, for a line longer than the longest string Node.js can hold.
    value = JSON.parse(bytes.toString("utf8"))
  } catch {
    return undefined // a half-written last line, or a line that is not JSON
  }
  if (!isObject(value) || value.type !== "assistant") return undefined
  const { message, requestId, sessionId, timestamp } = value
  if (!isObject(message) || typeof timestamp !== "string") return undefined
  const { id, model, usage } = message
  if (typeof id !== "string" || id === "" || model === SYNTHETIC || !isObject(usage)) return undefined
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return undefined
  const counts = readUsage(usage)
  if (!counts) return undefined
  return {
    // Copies keep message.id and requestId. Lines from before requestId was written fall back
    // to the session, as ccusage does; the two kinds of key cannot meet.
    key:
      typeof requestId === "string" && requestId !== ""
        ? JSON.stringify([id, requestId])
        : JSON.stringify([id, null, typeof sessionId === "string" ? sessionId : null]),
    model: typeof model === "string" && MODEL_NAME.test(model) ? model : OTHER,
    usage: counts,
    time,
  }
}

/**
 * The four counts of a `usage` object, or nothing when it has no input and output count. Missing
 * or null cache counts are 0. Before 2.1.152, cache_creation_input_tokens was 0 when the API
 * reported cache writes only in the nested cache_creation object; then that object's two fields
 * are the cache write.
 */
function readUsage(usage: Record<string, unknown>): Tokens | undefined {
  const { input_tokens: input, output_tokens: output, cache_creation: split } = usage
  const cacheRead = optionalCount(usage.cache_read_input_tokens)
  let cacheWrite = optionalCount(usage.cache_creation_input_tokens)
  if (!isCount(input) || !isCount(output) || cacheRead === undefined || cacheWrite === undefined) return undefined
  if (cacheWrite === 0 && isObject(split)) {
    const fiveMinutes = optionalCount(split.ephemeral_5m_input_tokens)
    const oneHour = optionalCount(split.ephemeral_1h_input_tokens)
    if (fiveMinutes !== undefined && oneHour !== undefined) cacheWrite = fiveMinutes + oneHour
  }
  return { input, output, cache_write: cacheWrite, cache_read: cacheRead }
}

/** Each response's usage added to its local day and its model: one record per day, by date. */
function days(responses: Iterable<Response>, timeZone: string): DayRecord[] {
  const byDay = new Map<string, Map<string, Tokens>>()
  for (const { model, usage, first } of responses) {
    const date = localDate(new Date(first), timeZone)
    let models = byDay.get(date)
    if (!models) {
      models = new Map()
      byDay.set(date, models)
    }
    models.set(model, addTokens(models.get(model) ?? NO_TOKENS, usage))
  }
  return [...byDay]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, models]) => ({
      date,
      provider: CLAUDE_CODE,
      tokens: [...models.values()].reduce(addTokens, NO_TOKENS),
      // Object.fromEntries makes each name an own key, so a name such as "__proto__" stays a name.
      models: Object.fromEntries([...models].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    }))
}
