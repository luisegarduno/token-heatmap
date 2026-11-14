// Made-up transcripts, and a profile repository in a temporary directory.
//
// Importing this module sets the test process up:
//
// - Every file a test writes goes under one temporary directory, removed when the test file ends.
// - git reads no configuration from this machine: an empty global file and no system file. So
//   no identity, signing or hook path of the developer's own changes what a test sees, and the
//   tests pass on a machine with no git identity, as in CI. Every GIT_ variable is cleared too.
// - The profile repository is a bare repository on disk. Nothing reaches the network.

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"
import { pathToFileURL } from "node:url"
import type { Config } from "../src/config.ts"
import { END, START } from "../src/readme.ts"

const base = mkdtempSync(join(tmpdir(), "token-heatmap-test-"))
after(() => rmSync(base, { recursive: true, force: true }))

/** A new, empty directory under this test file's temporary directory. */
export function scratch(name = "dir"): string {
  return mkdtempSync(join(base, `${name}-`))
}

/** The global git config file of every git this process starts. Empty unless a test writes to it. */
export const GIT_CONFIG_GLOBAL = join(base, "gitconfig")
writeFileSync(GIT_CONFIG_GLOBAL, "")
for (const name of Object.keys(process.env)) {
  if (name.startsWith("GIT_")) delete process.env[name]
}
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG_GLOBAL
process.env.GIT_CONFIG_NOSYSTEM = "1"

/** Runs git in `cwd` and returns its output. Throws, with git's own message, when git fails. */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

// ---------------------------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------------------------

/**
 * Writes transcript files, each given as its lines, under a projects directory, and returns that
 * directory: a new one unless `root` is given.
 *
 *   transcripts({ "-home-someone-app/session-1.jsonl": [assistant({ … }), …] })
 */
export function transcripts(files: Record<string, readonly string[]>, root = scratch("projects")): string {
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), lines.map((line) => `${line}\n`).join(""))
  }
  return root
}

let uuids = 0
const uuid = () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, "0")}`

/**
 * One transcript line of type "assistant", in the shape Claude Code writes today, with made-up
 * values. Token counts not given are 0.
 */
export function assistant(o: {
  id: string
  requestId: string
  timestamp?: string
  model?: string
  sessionId?: string
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
}): string {
  const usage = {
    input_tokens: o.input ?? 0,
    output_tokens: o.output ?? 0,
    cache_creation_input_tokens: o.cacheWrite ?? 0,
    cache_read_input_tokens: o.cacheRead ?? 0,
  }
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: "/home/someone/work/app",
    sessionId: o.sessionId ?? "11111111-2222-4333-8444-555555555555",
    version: "2.1.323",
    gitBranch: "main",
    entrypoint: "cli",
    type: "assistant",
    uuid: uuid(),
    timestamp: o.timestamp ?? "2026-11-12T18:00:00.000Z",
    requestId: o.requestId,
    message: {
      id: o.id,
      type: "message",
      role: "assistant",
      model: o.model ?? "claude-opus-5-5",
      content: [{ type: "text", text: "A made-up reply." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        ...usage,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: usage.cache_creation_input_tokens },
        iterations: [{ type: "message", input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }],
        output_tokens_details: { thinking_tokens: 0 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: "standard",
        speed: "standard",
        inference_geo: "global",
        fallback_credit: null,
      },
    },
  })
}

// ---------------------------------------------------------------------------------------------
// The profile repository
// ---------------------------------------------------------------------------------------------

/** A profile README with the two markers and text of the user's own around them. */
export const README = `# Hi, I'm a made-up user

Some text of my own.

${START}
${END}

More text after the block.
`

/** config.json as setup would write it, for a made-up user and machine. */
export const CONFIG: Config = {
  repository: "made-up-user/made-up-user",
  timeZone: "America/Los_Angeles",
  machine: "k3f9a2",
  models: true,
}

/** The profile's owner, for commits that are not the bot's. */
export const OWNER = "Profile Owner <owner@example.com>"
const AS_OWNER = ["-c", "user.name=Profile Owner", "-c", "user.email=owner@example.com", "-c", "commit.gpgsign=false"]

export type Commit = { sha: string; author: string; committer: string; subject: string; files: string[] }

export type Profile = {
  /** The bare repository that stands in for github.com/USER/USER. Its default branch is main. */
  remote: string
  /** The data directory: config.json, and repo/, a shallow clone of the remote. */
  dataDir: string
  /** The clone in the data directory. */
  clone: string
  /** The commits on the remote's main, newest first. */
  log(): Commit[]
  /** A file on the remote's main, or undefined when it has none. */
  file(path: string): string | undefined
  /** Pushes a commit by the owner to the remote's main that changes one file. */
  edit(path: string, change: (text: string) => string, subject?: string): void
}

/**
 * A bare repository whose main holds one commit by the owner, with `readme` as README.md, and a
 * data directory with config.json and a shallow clone of it, as setup will leave them.
 */
export function profileRepo(opts: { readme?: string; config?: Partial<Config> } = {}): Profile {
  const dir = scratch("profile")
  const remote = join(dir, "made-up-user.git")
  git(dir, ["init", "--quiet", "--bare", "--initial-branch=main", remote])
  const seed = join(dir, "seed")
  git(dir, ["clone", "--quiet", remote, seed])
  writeFileSync(join(seed, "README.md"), opts.readme ?? README)
  git(seed, ["add", "README.md"])
  git(seed, [...AS_OWNER, "commit", "--quiet", "--message", "Write my profile README"])
  git(seed, ["push", "--quiet", "origin", "HEAD:refs/heads/main"])
  rmSync(seed, { recursive: true, force: true })

  const dataDir = join(dir, "data")
  const clone = join(dataDir, "repo")
  mkdirSync(dataDir)
  writeFileSync(join(dataDir, "config.json"), `${JSON.stringify({ ...CONFIG, ...opts.config }, null, 2)}\n`)
  // A file:// address, because git ignores --depth for a plain local path.
  git(dir, ["clone", "--quiet", "--depth", "1", pathToFileURL(remote).href, clone])

  const inRemote = (args: string[]) => git(dir, ["--git-dir", remote, ...args])
  return {
    remote,
    dataDir,
    clone,
    log() {
      return inRemote(["log", "--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%s", "main"])
        .trimEnd()
        .split("\n")
        .map((line) => {
          const [sha, author, committer, subject] = line.split("\x1f")
          const files = inRemote(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha])
          return { sha, author, committer, subject, files: files.trimEnd().split("\n") }
        })
    },
    file(path) {
      if (inRemote(["ls-tree", "--name-only", "main", "--", path]) === "") return undefined
      return inRemote(["cat-file", "blob", `main:${path}`])
    },
    edit(path, change, subject = `Edit ${path}`) {
      const other = scratch("owner-clone")
      git(other, ["clone", "--quiet", remote, "."])
      writeFileSync(join(other, path), change(inRemote(["cat-file", "blob", `main:${path}`])))
      git(other, [...AS_OWNER, "commit", "--quiet", "--all", "--message", subject])
      git(other, ["push", "--quiet", "origin", "HEAD:refs/heads/main"])
    },
  }
}
