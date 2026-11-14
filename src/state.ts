// <data dir>/state.json and <data dir>/sync.lock: what the last sync did, and which sync runs now.
//
//   state.json   { "lastSync": "2026-11-14T18:02:11.000Z", "trigger": "Stop", "result": "pushed",
//                  "lastPush": "…", "lastError": { "time", "trigger", "message" },
//                  "skipped": { "count": 2, "time": "…", "trigger": "Stop" } }
//   sync.lock    { "pid": 4242, "time": "…", "token": "…" }   held for one sync
//
// A hook's sync stops when another holds the lock, and when the last sync was under an hour ago
// (5 minutes for SessionEnd). Only the sync that holds the lock writes state.json. Every function
// takes the clock as an argument.

import { randomUUID } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type Config, configPath, readConfig } from "./config.ts"

/** The hook events that run sync. A sync run by hand has none. */
export const TRIGGERS = ["SessionStart", "Stop", "SessionEnd"] as const
export type Trigger = (typeof TRIGGERS)[number]
export const isTrigger = (value: string): value is Trigger => (TRIGGERS as readonly string[]).includes(value)

export type State = {
  /** When the last sync that got past the lock and the limit started. */
  lastSync?: string
  /** That sync's hook event, or null for a sync run by hand. */
  trigger?: Trigger | null
  /** How it ended. */
  result?: "pushed" | "unchanged" | "error"
  /** When a sync last pushed a commit. */
  lastPush?: string
  /** The last sync that failed, kept after later ones succeed. */
  lastError?: { time: string; trigger: Trigger | null; message: string }
  /** The hooks the limit stopped since lastSync: how many, and the last one. */
  skipped?: { count: number; time: string; trigger: Trigger }
}

const MINUTE = 60_000

/** How long after a sync a hook's sync waits: 60 minutes, and 5 for SessionEnd, the last chance in a session. */
export const limitOf = (trigger: Trigger): number => (trigger === "SessionEnd" ? 5 : 60) * MINUTE

/** A lock older than this is taken over even when its process may still run. */
export const STALE_LOCK = 15 * MINUTE

export const statePath = (dataDir: string) => join(dataDir, "state.json")
export const lockPath = (dataDir: string) => join(dataDir, "sync.lock")

/** <dataDir>/state.json, or {} when there is none or it cannot be read: the next sync writes it anew. */
export function readState(dataDir: string): State {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(statePath(dataDir), "utf8"))
  } catch {
    return {}
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as State) : {}
}

/** Writes <dataDir>/state.json whole beside the old one, then renames it over, so a reader never sees half of one. */
export function writeState(dataDir: string, state: State): void {
  const path = statePath(dataDir)
  const next = `${path}.${process.pid}.tmp`
  writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(next, path)
}

/**
 * When a sync for `trigger` may run next, or undefined when it may run `now`. A last sync dated
 * after `now`, as after the clock was set back, does not hold one up.
 */
export function nextAllowed(state: State, trigger: Trigger, now: Date): Date | undefined {
  const last = state.lastSync === undefined ? Number.NaN : Date.parse(state.lastSync)
  if (Number.isNaN(last) || last > now.getTime()) return undefined
  const next = last + limitOf(trigger)
  return next > now.getTime() ? new Date(next) : undefined
}

/** state with one more hook stopped by the limit at `now`. */
export const withSkip = (state: State, trigger: Trigger, now: Date): State => ({
  ...state,
  skipped: { count: (state.skipped?.count ?? 0) + 1, time: now.toISOString(), trigger },
})

/** state after a sync that started at `now` ended in `result`, or in `error`. The skips start again at 0. */
export function withResult(
  state: State,
  o: { now: Date; trigger: Trigger | null } & ({ result: "pushed" | "unchanged" } | { error: string }),
): State {
  const time = o.now.toISOString()
  const { skipped: _, ...rest } = state
  if ("error" in o) {
    return {
      ...rest,
      lastSync: time,
      trigger: o.trigger,
      result: "error",
      lastError: { time, trigger: o.trigger, message: o.error },
    }
  }
  return {
    ...rest,
    lastSync: time,
    trigger: o.trigger,
    result: o.result,
    ...(o.result === "pushed" ? { lastPush: time } : {}),
  }
}

export type LockInfo = { pid: number; time: string; token: string }
export type Lock = { release(): void }

/** <dataDir>/sync.lock as written, or undefined when there is none or it cannot be read. */
export function readLock(dataDir: string): LockInfo | undefined {
  try {
    const value = JSON.parse(readFileSync(lockPath(dataDir), "utf8"))
    if (typeof value?.pid === "number" && typeof value?.time === "string" && typeof value?.token === "string") {
      return value
    }
  } catch {}
  return undefined
}

/**
 * Takes <dataDir>/sync.lock for this process, or returns undefined when another sync holds it. A
 * lock is stale, and taken over, when its process has ended, when it is older than STALE_LOCK,
 * or when it cannot be read and is more than 10 seconds old. release() removes the lock if it is
 * still this one.
 */
export function takeLock(dataDir: string, now: Date): Lock | undefined {
  const path = lockPath(dataDir)
  const mine: LockInfo = { pid: process.pid, time: now.toISOString(), token: randomUUID() }
  for (let attempt = 1; attempt <= 2; attempt++) {
    let fd: number
    try {
      fd = openSync(path, "wx")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 2) return undefined
      const held = readLock(dataDir)
      if (held === undefined ? justWritten(path, now) : !isStale(held, now)) return undefined
      // Take it over only if it is still the lock that was judged stale.
      if (readLock(dataDir)?.token !== held?.token) return undefined
      rmSync(path, { force: true })
      continue
    }
    try {
      writeFileSync(fd, `${JSON.stringify(mine)}\n`)
    } finally {
      closeSync(fd)
    }
    return {
      release() {
        if (readLock(dataDir)?.token === mine.token) rmSync(path, { force: true })
      },
    }
  }
  return undefined
}

/** True when `lock`'s process has ended, or it is older than STALE_LOCK, or dated after `now`. */
export function isStale(lock: LockInfo, now: Date): boolean {
  const age = now.getTime() - Date.parse(lock.time)
  if (Number.isNaN(age) || age < 0 || age > STALE_LOCK) return true
  return !isRunning(lock.pid)
}

/** A lock that cannot be read may be one that its sync is writing this moment. */
function justWritten(path: string, now: Date): boolean {
  try {
    const age = now.getTime() - statSync(path).mtimeMs
    return age >= 0 && age < 10_000
  } catch {
    return false
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" // there, and someone else's
  }
}

// ---------------------------------------------------------------------------------------------
// token-heatmap status
// ---------------------------------------------------------------------------------------------

/**
 * What `token-heatmap status` prints: the profile, then the last sync, push, skips and error from
 * state.json, a sync that runs now, and when the next one may run. Times are in the zone of
 * config.json, or this machine's when there is none.
 */
export function statusText(dataDir: string, now: Date): string {
  let config: Config | undefined
  try {
    config = readConfig(dataDir)
  } catch (error) {
    if (!existsSync(configPath(dataDir))) {
      return "token-heatmap is not set up on this machine: run /token-heatmap:setup in Claude Code.\n"
    }
    return `token-heatmap cannot sync: ${(error as Error).message}\n`
  }
  const zone = config.timeZone
  const at = (iso: string) => `${clock(iso, zone)} (${ago(iso, now)})`
  const on = (trigger: Trigger | null | undefined) => (trigger ? `on ${trigger}` : "run by hand")
  const state = readState(dataDir)
  const lines = [
    `Profile:    github.com/${config.repository}, machine ${config.machine}, days in ${zone}, ` +
      (config.models ? "model names published" : "no model names"),
  ]

  if (state.lastSync === undefined) {
    lines.push("Last sync:  none yet. The next SessionStart, Stop or SessionEnd hook runs one")
  } else {
    const result =
      state.result === "pushed"
        ? "pushed one commit"
        : state.result === "unchanged"
          ? "no number changed, so nothing was pushed"
          : "failed, see Last error"
    lines.push(`Last sync:  ${at(state.lastSync)}, ${on(state.trigger)}: ${result}`)
  }
  lines.push(`Last push:  ${state.lastPush === undefined ? "none yet" : at(state.lastPush)}`)
  if (state.skipped !== undefined) {
    const { count, time, trigger } = state.skipped
    lines.push(
      `Skipped:    ${count} ${count === 1 ? "hook" : "hooks"} since the last sync, as it was too recent; ` +
        `the last ${at(time)}, on ${trigger}`,
    )
  }
  lines.push(
    `Last error: ${
      state.lastError === undefined
        ? "none"
        : `${at(state.lastError.time)}, ${on(state.lastError.trigger)}: ${state.lastError.message}`
    }`,
  )
  const lock = readLock(dataDir)
  if (lock !== undefined && !isStale(lock, now)) lines.push(`Running:    a sync since ${at(lock.time)}`)
  if (state.lastSync !== undefined) {
    const hour = nextAllowed(state, "Stop", now)
    const end = nextAllowed(state, "SessionEnd", now)
    lines.push(
      `Next sync:  ${
        hour === undefined
          ? "at the next hook"
          : `at the first hook from ${clock(hour.toISOString(), zone)}` +
            (
              end === undefined
                ? ", or at the next SessionEnd"
                : `, or SessionEnd from ${clock(end.toISOString(), zone)}`
            )
      }`,
    )
  }
  return `${lines.join("\n")}\n`
}

/** "2026-11-14 10:02" in `zone`. */
function clock(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
function ago(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / MINUTE)
  const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`
  if (minutes < 1) return "just now"
  if (minutes < 120) return count(minutes, "minute")
  if (minutes < 48 * 60) return count(Math.floor(minutes / 60), "hour")
  return count(Math.floor(minutes / (24 * 60)), "day")
}
