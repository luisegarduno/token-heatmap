// <data dir>/config.json: what sync needs to know about this machine and its profile.
//
//   { "repository": "USER/USER", "timeZone": "America/Los_Angeles", "machine": "k3f9a2", "models": true }
//
// The data dir is --data-dir, or $CLAUDE_PLUGIN_DATA, which `claude plugin uninstall` deletes.
// Beside config.json it holds repo/, the clone of the profile repository. setup writes the file,
// and makes the machine id the first time.

import { randomInt } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
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

/** A GitHub repository written OWNER/NAME. */
export const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

/** A machine id: lowercase letters and digits. */
export const MACHINE_ID = /^[a-z0-9]{1,32}$/

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
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ConfigError(`${path}: not JSON`)
  }
  const problem = checkConfig(value)
  if (problem) throw new ConfigError(`${path}: ${problem}`)
  const { repository, timeZone, machine, models } = value as Config
  return { repository, timeZone, machine, models }
}

/**
 * Writes <dataDir>/config.json, making the directory if it has to. The file is written whole
 * beside the old one and then renamed over it, so a sync that reads it meanwhile reads one or
 * the other, never half of one.
 */
export function writeConfig(dataDir: string, config: Config): void {
  const { repository, timeZone, machine, models } = config
  const problem = checkConfig({ repository, timeZone, machine, models })
  if (problem) throw new ConfigError(`config.json not written: ${problem}`)
  mkdirSync(dataDir, { recursive: true })
  const path = configPath(dataDir)
  const next = `${path}.${process.pid}.tmp`
  writeFileSync(next, `${JSON.stringify({ repository, timeZone, machine, models }, null, 2)}\n`)
  renameSync(next, path)
}

/** What is wrong with a config.json, or undefined when nothing is. */
function checkConfig(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a JSON object"
  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) return `unknown key ${JSON.stringify(key)}`
  }
  const { repository, timeZone, machine, models } = value as Record<string, unknown>
  if (typeof repository !== "string" || !REPOSITORY.test(repository)) {
    return "repository is not a GitHub repository written USER/USER"
  }
  if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
    return "timeZone is not an IANA time zone such as America/Los_Angeles"
  }
  if (typeof machine !== "string" || !MACHINE_ID.test(machine))
    return "machine is not an id of lowercase letters and digits"
  if (typeof models !== "boolean") return "models is not true or false"
  return undefined
}

/** A new random machine id: six lowercase letters and digits, such as "k3f9a2". */
export function newMachineId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = ""
  for (let i = 0; i < 6; i++) id += alphabet[randomInt(alphabet.length)]
  return id
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

/** A zone as Node.js spells it: "america/los_angeles" reads "America/Los_Angeles". */
export const canonicalTimeZone = (zone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone

/** This machine's own time zone, or undefined when it has none Node.js knows. */
export function machineTimeZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return typeof zone === "string" && zone !== "" && isTimeZone(zone) ? canonicalTimeZone(zone) : undefined
}
