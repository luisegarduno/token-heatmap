// The only module that runs git, and the only one that knows where the files go: README.md and
// token-heatmap/ on the default branch of the profile repository, through the shallow clone in
// <data dir>/repo. The clone is ours alone, so each run resets it to the remote.
//
//   clone (setup)                                      over HTTPS, or over SSH if HTTPS is refused
//   git ls-remote --symref origin HEAD                 the default branch
//   git fetch --depth 1 origin BRANCH, reset --hard    the user's README comes from the remote
//   update(the fetched history.jsonl and README.md)    sync merges, renders and replaces the block
//   setup's images too, into token-heatmap/            sync never changes them
//   commit as token-heatmap[bot], then push            never --force
//   the push is refused because the remote moved: fetch, reset, update and push once more
//   it fails any other way: reset the clone to the remote's commit, and stop
//
// Commands that reach the remote run with GIT_TERMINAL_PROMPT=0 and ssh's BatchMode, so a push
// that would wait for a typed password or passphrase fails at once.

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The two files sync writes, as text. A file the branch does not have reads as "". */
export type Files = { history: string; readme: string }

/** The commit author and committer. The address is linked to no account, so the commits stay off the contribution graph. */
export const BOT = { name: "token-heatmap[bot]", email: "token-heatmap[bot]@users.noreply.github.com" } as const
export const COMMIT_MESSAGE = "Update token heatmap [skip ci]"

const README = "README.md"
const FOLDER = "token-heatmap"
const HISTORY = `${FOLDER}/history.jsonl`

/** The two addresses of a repository on github.com, in the order setup tries them. */
export const addresses = (repository: string) =>
  ({ https: `https://github.com/${repository}.git`, ssh: `git@github.com:${repository}.git` }) as const

/** True when `url` is an address of github.com/REPOSITORY, over HTTPS or SSH. GitHub reads names in any case. */
export function isAddressOf(url: string, repository: string): boolean {
  const name = repository.toLowerCase()
  const bare = url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
  return [`https://github.com/${name}`, `git@github.com:${name}`, `ssh://git@github.com/${name}`].includes(bare)
}

/**
 * Makes <dataDir>/repo a shallow clone of github.com/REPOSITORY, over HTTPS, or over SSH when
 * the HTTPS clone is refused. A clone of that repository that is there already is kept, because
 * publish fetches and resets it anyway, so one the user switched from HTTPS to SSH stays so. A
 * clone of `replaces`, the repository this data dir published to before, is removed first, and
 * so is an empty directory. Anything else in the way stops setup, and nothing is removed.
 * Returns origin's address.
 */
export async function clone(
  dataDir: string,
  repository: string,
  opts: { replaces?: string } = {},
): Promise<{ address: string; kept: boolean }> {
  const repo = join(dataDir, "repo")
  const env = gitEnv()
  if (existsSync(repo) && statSync(repo).isDirectory() && readdirSync(repo).length === 0) rmdirSync(repo)
  if (existsSync(repo)) {
    const origin = existsSync(join(repo, ".git"))
      ? await run(repo, ["config", "--get", "remote.origin.url"], env)
      : undefined
    const url = origin?.code === 0 ? origin.stdout.trim() : ""
    if (url !== "" && isAddressOf(url, repository)) return { address: url, kept: true }
    if (url === "" || opts.replaces === undefined || !isAddressOf(url, opts.replaces)) {
      throw new Error(
        `${repo} is in the way: token-heatmap keeps its clone of ${repository} there, and that is something else. ` +
          "Move it away, then run setup again",
      )
    }
    rmSync(repo, { recursive: true, force: true })
  }

  mkdirSync(dataDir, { recursive: true })
  const network = { ...env, GIT_TERMINAL_PROMPT: "0", ...(await batchSsh(dataDir, env)) }
  const refused: string[] = []
  for (const address of Object.values(addresses(repository))) {
    const result = await run(dataDir, ["clone", "--quiet", "--depth", "1", "--no-tags", "--", address, "repo"], network)
    if (result.code === 0) {
      if ((await run(repo, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], env)).code !== 0) {
        rmSync(repo, { recursive: true, force: true })
        throw new Error(
          `github.com/${repository} has no commits yet. Add a README.md to it on GitHub, then run setup again`,
        )
      }
      return { address, kept: false }
    }
    rmSync(repo, { recursive: true, force: true }) // git removes a clone it could not finish; this is in case
    refused.push(`${address}: ${result.stderr.trim() || `exit code ${result.code}`}`)
  }
  throw new Error(
    `cannot clone github.com/${repository}, over HTTPS or SSH. A profile README lives in a public repository ` +
      `named after the user, USER/USER: check that it exists. Git said:\n${refused.join("\n")}`,
  )
}

/**
 * Publishes `update`'s files to the default branch of the profile repository, in one commit by
 * token-heatmap[bot]. `update` gets the files as the remote has them, and runs again if the push
 * is refused because the remote moved meanwhile. `images`, by file name, go into token-heatmap/
 * in the same commit; sync gives none. Returns "unchanged", with no commit, when every file is as
 * the remote has it. What `update` throws stops the publish before any file is written. A commit
 * that cannot be pushed is undone: the clone is left at the remote's commit, with nothing else in
 * it, and a push the remote turns down throws a PushError.
 */
export async function publish(
  dataDir: string,
  update: (current: Files) => Files,
  opts: { images?: ReadonlyMap<string, Uint8Array> } = {},
): Promise<"pushed" | "unchanged"> {
  const repo = join(dataDir, "repo")
  if (!existsSync(join(repo, ".git"))) {
    throw new Error(`${repo} is not a clone of the profile repository. Run /token-heatmap:setup in Claude Code first`)
  }
  const images = [...(opts.images ?? [])]
  for (const [name] of images) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "history.jsonl")
      throw new Error(`not an image's file name: ${name}`)
  }
  const env = gitEnv()
  const network = { ...env, GIT_TERMINAL_PROMPT: "0", ...(await batchSsh(repo, env)) }
  const branch = await defaultBranch(repo, network)

  for (let attempt = 1; ; attempt++) {
    const base = await fetchBranch(repo, branch, network)
    await git(repo, ["reset", "--quiet", "--hard", base], env)
    const current = { history: await readAt(repo, base, HISTORY, env), readme: await readAt(repo, base, README, env) }
    const next = update(current)
    if (images.length === 0 && next.history === current.history && next.readme === current.readme) return "unchanged"

    let pushed: boolean
    try {
      mkdirSync(join(repo, FOLDER), { recursive: true })
      writeFileSync(join(repo, HISTORY), next.history)
      writeFileSync(join(repo, README), next.readme)
      for (const [name, bytes] of images) writeFileSync(join(repo, FOLDER, name), bytes)
      const paths = [README, HISTORY, ...images.map(([name]) => `${FOLDER}/${name}`)]
      await git(repo, ["add", "--force", "--", ...paths], env)
      if ((await run(repo, ["diff", "--cached", "--quiet"], env)).code === 0) {
        await git(repo, ["reset", "--quiet", "--hard", base], env)
        return "unchanged"
      }
      await commit(repo, env)
      pushed = await push(repo, branch, network)
    } catch (error) {
      await undo(repo, base, env)
      throw error
    }
    if (pushed) return "pushed"
    if (attempt === 2) {
      await undo(repo, base, env)
      throw new Error(
        `the push to ${branch} was refused twice, because the profile repository changed while sync ran. ` +
          "Nothing was forced, and the next sync tries again",
      )
    }
  }
}

/** Commits what is staged, as token-heatmap[bot]. */
async function commit(repo: string, env: NodeJS.ProcessEnv): Promise<void> {
  await git(
    repo,
    // No signing: a detached sync has no one to type a passphrase.
    [
      "-c",
      `user.name=${BOT.name}`,
      "-c",
      `user.email=${BOT.email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--message",
      COMMIT_MESSAGE,
    ],
    // The environment wins over any configuration, author.name and committer.email included.
    {
      ...env,
      GIT_AUTHOR_NAME: BOT.name,
      GIT_AUTHOR_EMAIL: BOT.email,
      GIT_COMMITTER_NAME: BOT.name,
      GIT_COMMITTER_EMAIL: BOT.email,
    },
  )
}

/** Puts the clone back at `base`, the remote's commit: no commit of ours, and no file of ours. */
async function undo(repo: string, base: string, env: NodeJS.ProcessEnv): Promise<void> {
  await run(repo, ["reset", "--quiet", "--hard", base], env)
}

/** The branch the remote's HEAD names: the one GitHub reads a profile README from. */
async function defaultBranch(repo: string, env: NodeJS.ProcessEnv): Promise<string> {
  const listed = await git(repo, ["ls-remote", "--symref", "origin", "HEAD"], env)
  const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(listed)
  if (!match) throw new Error("the profile repository has no default branch to publish to")
  return match[1]
}

/** Fetches the tip of `branch`, one commit deep, and returns its id. */
async function fetchBranch(repo: string, branch: string, env: NodeJS.ProcessEnv): Promise<string> {
  const tracking = `refs/remotes/origin/${branch}`
  await git(repo, ["fetch", "--quiet", "--depth", "1", "--no-tags", "origin", `+refs/heads/${branch}:${tracking}`], env)
  return (await git(repo, ["rev-parse", "--verify", "--quiet", `${tracking}^{commit}`], env)).trim()
}

/** A file's text in commit `rev`, or "" when the commit has no such file. */
async function readAt(repo: string, rev: string, path: string, env: NodeJS.ProcessEnv): Promise<string> {
  if ((await git(repo, ["ls-tree", "--name-only", rev, "--", path], env)) === "") return ""
  return git(repo, ["cat-file", "blob", `${rev}:${path}`], env)
}

/**
 * Pushes HEAD to `branch`. False when the remote refused it because it moved since the fetch. A
 * push that fails any other way throws a PushError.
 */
async function push(repo: string, branch: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const args = ["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`]
  const result = await run(repo, args, env)
  if (result.code === 0) return true
  // "!<tab>HEAD:refs/heads/main<tab>[rejected] (fetch first)". A hook or a protected branch
  // gives "[remote rejected]" instead, and a second try would fare no better.
  if (/^!\t[^\t]*\t\[rejected\]/m.test(result.stdout)) return false
  const refused = result.stdout.split("\n").filter((line) => line.startsWith("!\t"))
  throw new PushError(args, {
    ...result,
    stderr: [result.stderr.trim(), ...refused].filter(Boolean).join("\n"),
    declined: refused.some((line) => /\t\[remote rejected\]/.test(line)),
  })
}

/**
 * ssh with BatchMode on, as GIT_SSH_COMMAND, so it fails where it would ask for a passphrase or
 * a host key. It keeps the user's own ssh command when one is set. GIT_SSH names a program, not
 * a command line, so it is left as it is.
 */
async function batchSsh(dir: string, env: NodeJS.ProcessEnv): Promise<{ GIT_SSH_COMMAND?: string }> {
  if (env.GIT_SSH_COMMAND) return { GIT_SSH_COMMAND: `${env.GIT_SSH_COMMAND} -o BatchMode=yes` }
  if (env.GIT_SSH) return {}
  const configured = await run(dir, ["config", "--get", "core.sshCommand"], env)
  return { GIT_SSH_COMMAND: `${(configured.code === 0 && configured.stdout.trim()) || "ssh"} -o BatchMode=yes` }
}

/**
 * This process's environment, without the variables that point git at another repository, as
 * when git runs a hook: every command names the clone with -C. LC_ALL=C keeps git's output in
 * the words push() reads.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" }
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
  ]) {
    delete env[name]
  }
  return env
}

type Result = { code: number; stdout: string; stderr: string }

/** A git command that failed, with what git said. */
export class GitError extends Error {
  constructor(args: readonly string[], result: Result) {
    const command = args.find((arg, i) => !arg.startsWith("-") && args[i - 1] !== "-c") ?? "git"
    super(`git ${command} failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
    this.name = "GitError"
  }
}

/**
 * A push that failed other than because the remote moved: refused sign-in, an address that
 * leads nowhere, or a commit the remote turned down. `declined` is true for the last, as a
 * protected branch or a hook on the remote gives.
 */
export class PushError extends GitError {
  readonly declined: boolean

  constructor(args: readonly string[], result: Result & { declined: boolean }) {
    super(args, result)
    this.name = "PushError"
    this.declined = result.declined
  }
}

/** Runs git in the clone and returns its output. Throws a GitError when git fails. */
async function git(repo: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const result = await run(repo, args, env)
  if (result.code !== 0) throw new GitError(args, result)
  return result.stdout
}

/** Runs git in `dir`, with no input, and returns its exit code and output. */
function run(dir: string, args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", dir, ...args], { env, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error("git was not found on PATH. Install git, then try again") : error)
    })
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })
  })
}
