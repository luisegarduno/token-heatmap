// Claude Code's provider: daily token counts from the transcripts under ~/.claude/projects.
//
// Usage lives at `message.usage` on lines of type "assistant". Claude Code writes one such line
// per content block, so one API response appears on about three lines that repeat its
// `message.id`, `requestId` and usage; a resumed or forked session copies those lines into
// another file. A response is counted once, with the largest usage among its lines, on the local
// date of its earliest line and under the model its lines name.
//
//   ~/.claude/projects/<project>/<session>.jsonl
//   ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl
//
// This reads the format Claude Code writes today. A line of another kind, or an assistant line
// that lacks a field of that format, is not counted.

import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { localDate } from "../store.ts"
import { addTokens, type DayRecord, NO_TOKENS, type Provider, type Tokens, totalOf } from "./provider.ts"

export const CLAUDE_CODE = "claude-code"

/** One API response, from the lines that carry it. */
type Response = { model: string; usage: Tokens; first: number }

/**
 * The Claude Code provider. `root` is the projects directory to read, ~/.claude/projects unless
 * given; a missing directory holds no usage.
 */
export function claudeCode(opts: { root?: string } = {}): Provider {
  return {
    id: CLAUDE_CODE,
    async collect({ timeZone }) {
      const root = opts.root ?? join(homedir(), ".claude", "projects")
      const responses = new Map<string, Response>()
      for (const file of await transcriptFiles(root)) {
        const lines = (await readFile(file, "utf8")).split("\n")
        lines.forEach((text, index) => {
          if (text.trim() === "") return
          let value: unknown
          try {
            value = JSON.parse(text)
          } catch {
            throw new Error(`${file}:${index + 1}: not JSON`)
          }
          const line = readAssistantLine(value)
          if (!line) return
          const seen = responses.get(line.key)
          if (!seen) {
            responses.set(line.key, { model: line.model, usage: line.usage, first: line.time })
            return
          }
          if (totalOf(line.usage) > totalOf(seen.usage)) seen.usage = line.usage
          if (line.time < seen.first) seen.first = line.time // the earliest line decides the day
        })
      }
      return days(responses.values(), timeZone)
    },
  }
}

/** Every *.jsonl file under `root`, at any depth, sorted. Symbolic links are not followed. */
async function transcriptFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string) => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (dir === root && (error as NodeJS.ErrnoException).code === "ENOENT") return
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** The response a transcript line carries usage for, or nothing for any other line. */
function readAssistantLine(value: unknown): { key: string; model: string; usage: Tokens; time: number } | undefined {
  if (!isObject(value) || value.type !== "assistant") return undefined
  const { message, requestId, timestamp } = value
  if (!isObject(message) || typeof requestId !== "string" || typeof timestamp !== "string") return undefined
  const { id, model, usage } = message
  if (typeof id !== "string" || typeof model !== "string" || model === "" || !isObject(usage)) return undefined
  const time = Date.parse(timestamp)
  if (Number.isNaN(time)) return undefined
  const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = usage
  if (
    !isCount(input_tokens) ||
    !isCount(output_tokens) ||
    !isCount(cache_creation_input_tokens) ||
    !isCount(cache_read_input_tokens)
  ) {
    return undefined
  }
  return {
    key: JSON.stringify([id, requestId]),
    model,
    usage: {
      input: input_tokens,
      output: output_tokens,
      cache_write: cache_creation_input_tokens,
      cache_read: cache_read_input_tokens,
    },
    time,
  }
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
