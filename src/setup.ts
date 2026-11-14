// setup: the plan, then one push in the foreground. /token-heatmap:setup runs it.
//
//   token-heatmap setup --data-dir DIR --repo USER [--timezone ZONE] [--models | --no-models] [--adopt ID] [--yes]
//
//   without --yes   print the plan and change nothing: repository, time zone, machine id, days
//                   found, model names to be published. Nothing is written, and nothing reaches
//                   the network
//   with --yes      clone github.com/USER/USER into DIR/repo, over HTTPS, or over SSH if that is refused
//                   history.jsonl holds other machines' lines and none of this one's: stop and
//                     name them. --adopt ID goes on as that machine
//                   add the two markers at the end of README.md if it has neither, merge, render,
//                     copy the images to token-heatmap/, commit as token-heatmap[bot] and push
//                   write config.json once the remote has the commit, so a setup that fails
//                     leaves no config.json behind for a sync to run on
//   --timezone      on a machine that is set up: config.json changes, and nothing else. The days
//                   already recorded stay as they are
//
// On a machine that is set up, a run keeps the machine id, the zone and the choice of model
// names in config.json. Only a flag changes one: --no-models is never undone by leaving it out.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Config,
  ConfigError,
  canonicalTimeZone,
  configPath,
  isTimeZone,
  machineTimeZone,
  newMachineId,
  readConfig,
  writeConfig,
} from "./config.ts"
import type { HistoryLine, Provider } from "./providers/provider.ts"
import { addresses, clone, PushError, publish } from "./publish/git-readme.ts"
import { withMarkers } from "./readme.ts"
import { IMAGE_FILES } from "./render.ts"
import { localDate } from "./store.ts"
import { collect, nextFiles, readHistory, withoutModels } from "./sync.ts"

export type SetupOptions = {
  dataDir: string
  /** The profile repository, USER/USER: see profileRepository(). */
  repository: string
  /** --timezone: an IANA zone. */
  timeZone?: string
  /** --models (true) or --no-models (false). Neither: what config.json says, or true on a first setup. */
  models?: boolean
  /** --adopt ID: go on as the machine whose lines the history holds under ID. */
  adopt?: string
  /** --yes: publish. Without it, setup prints the plan and changes nothing. */
  yes: boolean
  providers: readonly Provider[]
  now: Date
  /** The directory that holds the block's images: plugin/assets. */
  assets: string
}

export type Report = {
  /**
   * planned: nothing changed. configured: config.json alone changed. pushed and unchanged:
   * whether the profile repository got a commit; config.json is written in both.
   */
  done: "planned" | "configured" | "pushed" | "unchanged"
  /** What to print, ending in a newline. */
  text: string
}

/** USER/USER for --repo USER, and for --repo USER/USER itself. Undefined for anything else. */
export function profileRepository(arg: string): string | undefined {
  const [owner, name, ...rest] = arg.split("/")
  if (rest.length > 0 || !/^[A-Za-z0-9-]{1,39}$/.test(owner)) return undefined
  if (name !== undefined && name.toLowerCase() !== owner.toLowerCase()) return undefined
  return `${owner}/${owner}`
}

/** Prints the plan, or with `yes`, publishes it: see the top of this file. */
export async function setup(opts: SetupOptions): Promise<Report> {
  const config = existingConfig(opts.dataDir)
  if (opts.timeZone !== undefined && !isTimeZone(opts.timeZone)) {
    throw new Error(`--timezone takes an IANA time zone such as America/Los_Angeles, not ${opts.timeZone}`)
  }
  if (config && opts.timeZone !== undefined) return changeConfig(config, { ...opts, timeZone: opts.timeZone })

  const timeZone =
    opts.timeZone !== undefined ? canonicalTimeZone(opts.timeZone) : (config?.timeZone ?? machineTimeZone())
  if (timeZone === undefined) {
    throw new Error(
      "cannot tell this machine's time zone. Run setup again with --timezone ZONE, such as America/Los_Angeles",
    )
  }
  const models = opts.models ?? config?.models ?? true
  const images = readImages(opts.assets)
  const collected = await collect(opts.providers, timeZone)

  if (!opts.yes) {
    return {
      done: "planned",
      text: planText({
        repository: opts.repository,
        previous: config && !same(config.repository, opts.repository) ? config.repository : undefined,
        timeZone,
        machine: opts.adopt ?? config?.machine,
        adopt: opts.adopt !== undefined,
        models,
        modelsKept: opts.models === undefined && config !== undefined,
        dates: [...new Set(collected.map((record) => record.date))].sort(),
        modelNames: [...new Set(collected.flatMap((record) => Object.keys(record.models ?? {})))].sort(),
      }),
    }
  }

  const repo = join(opts.dataDir, "repo")
  const { address } = await clone(opts.dataDir, opts.repository, { replaces: config?.repository })
  const records = models ? collected : withoutModels(collected)
  const today = localDate(opts.now, timeZone)
  const own = config?.machine ?? newMachineId()
  let chosen = { machine: own, others: [] as string[] }
  let done: "pushed" | "unchanged"
  try {
    done = await publish(
      opts.dataDir,
      (current) => {
        const history = readHistory(current.history, opts.repository)
        chosen = whichMachine(history, { repository: opts.repository, own, adopt: opts.adopt })
        return nextFiles({ history, readme: withMarkers(current.readme), records, machine: chosen.machine, today })
      },
      { images },
    )
  } catch (error) {
    if (error instanceof PushError) throw new Error(refusedPush(error, { repository: opts.repository, address, repo }))
    throw error
  }
  writeConfig(opts.dataDir, { repository: opts.repository, timeZone, machine: chosen.machine, models })

  return {
    done,
    text: lines(
      done === "pushed"
        ? `Pushed one commit by token-heatmap[bot] to github.com/${opts.repository}. The profile shows it at https://github.com/${opts.repository.split("/")[0]}`
        : `github.com/${opts.repository} has this block, history and images already, so nothing was pushed.`,
      `This machine's id is ${chosen.machine}, and config.json in ${opts.dataDir} holds it.`,
      chosen.others.length > 0 ? `The lines of ${list(chosen.others)} in history.jsonl stay as they are.` : undefined,
    ),
  }
}

/** config.json when there is one. One that cannot be read stops setup, with what to do. */
function existingConfig(dataDir: string): Config | undefined {
  if (!existsSync(configPath(dataDir))) return undefined
  try {
    return readConfig(dataDir)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    throw new Error(
      `${error.message}. Fix it, or delete it to set this machine up anew; its lines in history.jsonl can then be taken over with --adopt ID`,
    )
  }
}

/**
 * --timezone on a machine that is set up: config.json takes the new zone, and the choice of
 * model names when --models or --no-models is given. Nothing is cloned or pushed, and the days
 * already in history.jsonl stay as they are.
 */
function changeConfig(config: Config, opts: SetupOptions & { timeZone: string }): Report {
  if (!same(config.repository, opts.repository)) {
    throw new Error(
      `this machine is set up for ${config.repository}. On a machine that is set up, --timezone changes config.json only: ` +
        `run setup without it to publish to ${opts.repository}`,
    )
  }
  if (opts.adopt !== undefined) {
    throw new Error(
      "on a machine that is set up, --timezone changes config.json only, and --adopt needs the history: run setup with --adopt first, then with --timezone",
    )
  }
  const next: Config = { ...config, timeZone: canonicalTimeZone(opts.timeZone), models: opts.models ?? config.models }
  const changes = [
    next.timeZone === config.timeZone ? undefined : row("Time zone", `${config.timeZone}, to become ${next.timeZone}`),
    next.models === config.models
      ? undefined
      : row("Model names", next.models ? "not published, to become published" : "published, to become not published"),
  ].filter((change) => change !== undefined)
  if (changes.length === 0) {
    return { done: "unchanged", text: lines(`config.json counts days in ${next.timeZone} already. Nothing to change.`) }
  }
  const after = "Nothing is pushed, and the days already in history.jsonl stay as they are."
  if (!opts.yes) {
    return {
      done: "planned",
      text: lines(
        "token-heatmap setup: the plan. Nothing has changed yet.",
        "",
        ...changes,
        "",
        `Only config.json changes. ${after} From the next sync on, days are counted in ${next.timeZone}.`,
        "Run setup again with --yes to make the change.",
      ),
    }
  }
  writeConfig(opts.dataDir, next)
  return { done: "configured", text: lines(`config.json now counts days in ${next.timeZone}. ${after}`) }
}

/**
 * The machine whose lines a setup writes, and the other machines whose lines the history holds.
 * A history that holds other machines' lines and none of `own`'s stops setup: a second machine
 * must not count its days next to the first one's unseen, and a reinstall has a new id.
 * `adopt` goes on as one of the machines the history holds.
 */
function whichMachine(
  history: readonly HistoryLine[],
  o: { repository: string; own: string; adopt?: string },
): { machine: string; others: string[] } {
  const ids = [...new Set(history.map((line) => line.machine))].sort()
  const where = `token-heatmap/history.jsonl in ${o.repository}`
  if (o.adopt !== undefined) {
    if (!ids.includes(o.adopt)) {
      throw new Error(
        `--adopt ${o.adopt}: ${where} has no lines of that machine, ` +
          `${ids.length > 0 ? `only of ${list(ids)}` : "and no lines at all yet"}. Nothing was published`,
      )
    }
    return { machine: o.adopt, others: ids.filter((id) => id !== o.adopt) }
  }
  const others = ids.filter((id) => id !== o.own)
  if (others.length > 0 && !ids.includes(o.own)) {
    const one = others.length === 1
    throw new Error(
      lines(
        `${where} has the lines of ${one ? "another machine" : "other machines"}, ${list(others)}, and none of this one's. Nothing was published.`,
        one
          ? `If they are this machine's own, from an earlier install, run setup again with --adopt ${others[0]} to go on with them.`
          : "If one of them is this machine's own, from an earlier install, run setup again with --adopt and its id to go on with it.",
        "If another machine still publishes to this profile, set it up there only: token-heatmap publishes from one machine.",
      ).trimEnd(),
    )
  }
  return { machine: o.own, others }
}

/** What setup prints when the push is refused: git's reason, then the fix. */
function refusedPush(error: PushError, o: { repository: string; address: string; repo: string }): string {
  return lines(
    `the push to ${o.repository} was refused, so nothing was published. ${error.message}`,
    error.declined
      ? `GitHub turned the commit down, as it does on a protected branch: let your account push to the default branch of ${o.repository}, then run setup again.`
      : "To fix it, run `gh auth setup-git`, so that git signs in to github.com with your GitHub CLI login, then run setup again.",
    !error.declined && !o.address.startsWith("https://")
      ? `This clone reaches GitHub over SSH, which that does not change: load your key with \`ssh-add\`, or switch the clone to HTTPS first with \`git -C "${o.repo}" remote set-url origin ${addresses(o.repository).https}\`.`
      : undefined,
  ).trimEnd()
}

type Plan = {
  repository: string
  /** The repository config.json names, when it is another one. */
  previous?: string
  timeZone: string
  /** The id from config.json or --adopt, or undefined for a new one. */
  machine?: string
  adopt: boolean
  models: boolean
  /** True when `models` is config.json's choice, kept because no flag changed it. */
  modelsKept: boolean
  /** Each date with usage, sorted. */
  dates: string[]
  /** Every model name the days hold, sorted. */
  modelNames: string[]
}

function planText(plan: Plan): string {
  const days = plan.dates.length
  return lines(
    "token-heatmap setup: the plan. Nothing has changed yet.",
    "",
    row(
      "Repository",
      `github.com/${plan.repository}, its default branch${plan.previous ? `, in place of ${plan.previous}` : ""}`,
    ),
    row("Time zone", `${plan.timeZone}: it decides which day each response counts on`),
    row(
      "Machine id",
      plan.adopt
        ? `${plan.machine}, taken over with --adopt: the history must have lines of it`
        : plan.machine
          ? `${plan.machine}, from config.json`
          : "a new random one",
    ),
    row(
      "Days found",
      days === 0
        ? "none yet: the block shows a year of no tokens until there is usage"
        : `${days} ${days === 1 ? "day" : "days"} with usage, ${plan.dates[0]} to ${plan.dates[days - 1]}`,
    ),
    row(
      "Model names",
      !plan.models
        ? plan.modelsKept
          ? "none: this machine is set up with --no-models, and --models would publish them"
          : "none: --no-models keeps them out"
        : plan.modelNames.length === 0
          ? "none found yet"
          : plan.modelNames.join(", "),
    ),
    "",
    `With --yes, setup pushes one commit by token-heatmap[bot] to github.com/${plan.repository}: README.md with the block between two marker lines, added at its end if it has none, and in token-heatmap/, history.jsonl and the block's ${IMAGE_FILES.length} images.`,
    `history.jsonl holds, for each day: the date, the provider, this machine's id, and the token counts by type${plan.models ? " and by model. A model name first seen later is published too" : ""}.`,
    "What is pushed stays in the repository's git history.",
    "Run setup again with --yes to publish.",
  )
}

/** The block's images from the plugin's own directory, by file name. */
function readImages(assets: string): Map<string, Buffer> {
  const images = new Map<string, Buffer>()
  for (const name of IMAGE_FILES) {
    try {
      images.set(name, readFileSync(join(assets, name)))
    } catch (error) {
      throw new Error(
        `the plugin's image ${name} cannot be read from ${assets}: ${(error as Error).message}. Reinstall the plugin, then run setup again`,
      )
    }
  }
  return images
}

/** GitHub reads a repository's name in any case. */
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const row = (name: string, value: string) => `  ${name.padEnd(12)} ${value}`

/** "a", "a and b", "a, b and c". */
const list = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

/** The lines that are not undefined, each ending in a newline. */
const lines = (...text: (string | undefined)[]) =>
  text
    .filter((line) => line !== undefined)
    .map((line) => `${line}\n`)
    .join("")
