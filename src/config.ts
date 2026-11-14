// <data dir>/config.json: what sync needs to know about this machine and its profile.
//
//   { "repository": "USER/USER", "timeZone": "America/Los_Angeles", "machine": "k3f9a2", "models": true }
//
// The data dir is --data-dir, or $CLAUDE_PLUGIN_DATA, which `claude plugin uninstall` deletes.
// Beside config.json it holds repo/, the clone of the profile repository.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Config = {
  /** The profile repository, USER/USER. */
  repository: string
  /** The IANA zone that decides which day a response belongs to. */
  timeZone: string
  /** This machine's random id, written on each of its history lines. */
  machine: string
  /** Whether history lines hold each day's counts by model. */
  models: boolean
}

const KEYS: readonly string[] = ["repository", "timeZone", "machine", "models"]

/** config.json is missing, or cannot be read. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export const configPath = (dataDir: string) => join(dataDir, "config.json")

/** Reads and checks <dataDir>/config.json. */
export function readConfig(dataDir: string): Config {
  const path = configPath(dataDir)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(`${path} does not exist. Run /token-heatmap:setup in Claude Code first`)
    }
    throw new ConfigError(`cannot read ${path}: ${(error as Error).message}`)
  }
  const problem = (what: string) => new ConfigError(`${path}: ${what}`)

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw problem("not JSON")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw problem("not a JSON object")
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) throw problem(`unknown key ${JSON.stringify(key)}`)
  }
  const { repository, timeZone, machine, models } = value as Record<string, unknown>
  if (typeof repository !== "string" || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    throw problem("repository is not a GitHub repository written USER/USER")
  }
  if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
    throw problem("timeZone is not an IANA time zone such as America/Los_Angeles")
  }
  if (typeof machine !== "string" || !/^[a-z0-9]{1,32}$/.test(machine)) {
    throw problem("machine is not an id of lowercase letters and digits")
  }
  if (typeof models !== "boolean") throw problem("models is not true or false")
  return { repository, timeZone, machine, models }
}

/** True for a time zone this Node.js knows, such as "UTC" or "America/Los_Angeles". */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}
