# token-heatmap

A heatmap of your daily Claude Code token usage in your GitHub profile README, laid out like GitHub's contribution graph: the last 12 months, one square per day, darker for heavier days. Rest the pointer on a day and the browser shows its tokens:

```text
96.4M tokens on June 10th.
```

It is a Claude Code plugin. It reads the usage Claude Code already records on your machine, and pushes the daily totals and the heatmap to your own profile repository with your own git credentials. Nothing is hosted, there is no server and no secret, it costs nothing, and it needs no account beyond GitHub.

- [Before you start](#before-you-start)
- [Setup](#setup)
- [How it works](#how-it-works)
- [What leaves your machine](#what-leaves-your-machine)
- [The history file](#the-history-file)
- [Fixes](#fixes)
- [Uninstall](#uninstall)

## Before you start

You need:

- **Claude Code**: the CLI, the desktop app or the Agent SDK. Usage from claude.ai or from the API outside Claude Code is not counted.
- **Node.js 20 or later**, as `node` on the `PATH` that Claude Code starts with. Claude Code's native installer does not bring it.
- **git**, able to push to `github.com` without asking for a password. If you use the GitHub CLI, `gh auth login`, then `gh auth setup-git`, does that. An SSH key loaded in your agent, or a credential manager, works too.
- **Your profile repository**: the public repository named after your user name, `USER/USER`, whose README GitHub shows on your profile. If you do not have one, create it on GitHub with "Add a README file" ticked, so it has a first commit.

macOS and Linux are supported. Windows has a launcher and runs the unit tests in CI, with no promise yet.

## Setup

In a terminal:

```sh
claude plugin marketplace add luisegarduno/token-heatmap
claude plugin install token-heatmap@token-heatmap
```

Inside Claude Code, `/plugin marketplace add luisegarduno/token-heatmap` and `/plugin install token-heatmap@token-heatmap` do the same. Then, in a new Claude Code session:

```text
/token-heatmap:setup
```

Setup asks for your GitHub user name, unless you give it (`/token-heatmap:setup octocat`). It first shows a plan and changes nothing: the repository, the time zone that decides each day, how many days of usage it found, and the model names it would publish. Read the model names: what is pushed stays in your repository's git history. Answer yes and setup:

1. clones `USER/USER` into the plugin's data directory, over HTTPS, or over SSH if that fails,
2. imports every day of usage still on your machine,
3. adds two marker lines at the end of your README, with the heatmap between them,
4. adds `token-heatmap/` beside your README, with `history.jsonl` and the heatmap's images,
5. pushes all of it as one commit by `token-heatmap[bot]`.

Your profile shows the heatmap a moment later. From then on, it updates by itself while you use Claude Code.

Setup takes these options after the user name:

| Option | What it does |
| --- | --- |
| `--no-models` | Publish each day's counts by type only, with no model names. Later runs keep the choice; `--models` publishes the names again |
| `--timezone ZONE` | The IANA time zone that decides which day a response counts on, such as `Europe/Berlin`. It defaults to your machine's. On a machine that is set up, it changes the zone only: the days already recorded stay as they are |
| `--adopt ID` | Go on as machine `ID`, whose lines your history holds from an earlier install. See [Fixes](#fixes) |

To move the heatmap, move the two marker lines in your README, with nothing but the heatmap between them:

```html
<!-- token-heatmap:start -->
<!-- token-heatmap:end -->
```

`/token-heatmap:status` shows when it last synced, what it pushed, the hooks it skipped and the last error.

## How it works

```text
Claude Code hook: SessionStart, Stop or SessionEnd
  └─ token-heatmap sync                    returns at once; a detached copy does the work
       at most once an hour, or 5 minutes after the last sync at a session's end
       read every transcript under ~/.claude/projects     ($CLAUDE_CONFIG_DIR/projects if set)
       count each API response once, on its day in your time zone
       fetch your profile repository
       merge the days into token-heatmap/history.jsonl    a recorded day never goes down
       draw the heatmap between the README's markers      from history.jsonl alone
       if a number changed: one commit by token-heatmap[bot], pushed to the default branch
```

- **Which tokens.** All four types count toward each day's number: input, output, cache write and cache read. Most of it is cache reads. Each API response is counted once, with the largest usage among the transcript lines that repeat it, so a day can be checked against `ccusage daily`.
- **Which day.** A response counts on the date of its first line in the time zone set at setup. Travel does not move recorded days.
- **The history outlives your transcripts.** Claude Code deletes CLI transcripts after 30 days. A day recorded in `history.jsonl` stays, and a sync only ever raises a count.
- **The levels.** A day with no usage is level 0. The days with usage are cut at their 25th, 50th and 75th percentile into levels 1 to 4, so light and heavy users both get a readable graph.
- **The commits stay off your contribution graph.** They are authored by `token-heatmap[bot]`, whose address is linked to no account. The message is `Update token heatmap [skip ci]`.
- **When it runs.** Only while Claude Code is in use, so after idle days the last column can be days old until your next session. GitHub caches the images for 5 minutes.
- **Where.** The tooltip shows in desktop browsers, about half a second after the pointer stops. Touch screens show no tooltip. On a narrow screen the grid scrolls sideways, as GitHub's own graph does. A click on a day opens `history.jsonl`.

The plugin keeps its local files in its data directory, `~/.claude/plugins/data/token-heatmap-token-heatmap/`:

```text
config.json    your profile repository, time zone, machine id, and whether model names are published
state.json     the last sync, push, skips and error, which /token-heatmap:status prints
sync.lock      held while one sync runs
repo/          a shallow clone of your profile repository, which every sync resets to GitHub's copy
```

The code is in four parts: collect (`src/providers/`), store (`src/store.ts`), draw (`src/render.ts`) and publish (`src/publish/git-readme.ts`). Only the collector knows Claude Code's transcripts. [docs/providers.md](docs/providers.md) says how to add another tool.

## What leaves your machine

Only these fields, in `token-heatmap/history.jsonl` in your profile repository:

| Field | What it holds |
| --- | --- |
| `date` | The day, written YYYY-MM-DD, in the time zone set at setup |
| `provider` | The tool the tokens come from: `claude-code` |
| `machine` | A random id of six lowercase letters and digits, made at setup, such as `k3f9a2`. It tells your machines apart, and says nothing about this one |
| `tokens` | The day's four counts, added up over every model |
| `models` | The same four counts for each model, by model name. Left out with `--no-models` |
| `input`, `output`, `cache_write`, `cache_read` | The four counts in `tokens` and in each model's entry: whole numbers of input tokens, output tokens, tokens written to the prompt cache, and tokens read from it |

A model name is published as Claude Code records it, such as `claude-opus-5-5`, when it matches `^[A-Za-z0-9._:@-]{1,64}$`. Any other name, such as a cloud resource address that can hold an account number, counts under `other`. Setup lists the model names before its first push. A model first seen later is published too.

The heatmap in your README is drawn from `history.jsonl` alone: its total and its tooltips hold nothing else. The images are the same files for everyone. Each commit is by `token-heatmap[bot]` with the message `Update token heatmap [skip ci]`, and like every git commit it records the time it was made, with your machine's offset from UTC.

Nothing else leaves: no prompts, replies or code, no file paths, project or branch names, no session or request ids, no transcripts. A test, [`test/published-fields.test.ts`](test/published-fields.test.ts), plants such strings in made-up transcripts, syncs them into a repository on disk, and fails if anything but the fields above, or any planted string, reaches any object in it. Another, [`test/docs.test.ts`](test/docs.test.ts), fails if this table and the test's list differ.

Everything is public once pushed, because a profile repository is public, and it stays in that repository's git history.

## The history file

`token-heatmap/history.jsonl` is the only store. It is plain JSON Lines: one line for each day, provider and machine, sorted by those three. This line is made up:

```json
{"date":"2026-11-12","provider":"claude-code","machine":"k3f9a2","tokens":{"input":1820,"output":412233,"cache_write":1502211,"cache_read":61200412},"models":{"claude-opus-5-5":{"input":1701,"output":371010,"cache_write":1396302,"cache_read":57812400},"claude-sonnet-5-5":{"input":119,"output":41223,"cache_write":105909,"cache_read":3388012}}}
```

- Keys come in the order above, and model names are sorted.
- `tokens` is the sum of `models`, type by type. A line written with `--no-models` has `tokens` alone.
- A day with no line counts as no tokens.
- There is one line at most for each day, provider and machine, and a line has no other key. Every count is a whole number, 0 or more.

It lives in your own repository, so its git history is its backup. To draw the heatmap again from a copy of it alone, with no plugin installed and no network, you need only Node.js 20 or later:

```sh
git clone https://github.com/luisegarduno/token-heatmap
token-heatmap/plugin/bin/token-heatmap render --history history.jsonl --today 2026-11-13
```

It prints the HTML that goes between the markers, for the year that ends on `--today`, which defaults to today. On Windows, run `token-heatmap\plugin\bin\token-heatmap.cmd`.

## Fixes

Start with `/token-heatmap:status`: it names the last error, if any. Setup prints the same messages, and the fix with them.

| Message or symptom | Fix |
| --- | --- |
| `node was not found on PATH`, or `the node on PATH is v18…` | Install Node.js 20 or later, and make sure `node` is on the `PATH` that Claude Code starts with. A desktop app started from the dock may not see a `PATH` set in your shell's startup file |
| The push was refused, or `If git could not sign in, run gh auth setup-git` | Run `gh auth setup-git`, so that git signs in to github.com with your GitHub CLI login. A clone over SSH needs its key loaded with `ssh-add`. A sync never asks for a password: it fails, records the error, and tries again at the next hook |
| `GitHub turned the commit down, as it does on a protected branch` | Let your account push to the default branch of `USER/USER`, then run setup again |
| `history.jsonl … has the lines of another machine` | If they are this machine's own, from an earlier install, run `/token-heatmap:setup USER --adopt ID` with the id the message names. If another machine still publishes to this profile, keep it there: token-heatmap publishes from one machine |
| `README.md has no "<!-- token-heatmap:start -->" line followed by an "<!-- token-heatmap:end -->" line` | Put the two marker lines back where the heatmap should go, or run setup, which adds them at the end |
| `README.md has a "<!-- token-heatmap:start -->" line with no "<!-- token-heatmap:end -->" line after it` | Add the missing marker, or delete the one that is there, then run setup again |
| `cannot clone github.com/USER/USER`, or `has no commits yet` | Check that `USER/USER` exists on GitHub and has a README. See [Before you start](#before-you-start) |
| `… repo is in the way` | Something other than token-heatmap's clone is in the data directory's `repo/`. Move it away, then run setup again |
| `token-heatmap/history.jsonl in USER/USER: line N: …` | That line was edited into a shape token-heatmap cannot read. Fix the line, or revert the commit that changed it, in your profile repository |
| The profile does not change | Status shows the last sync and when the next may run. Syncs run at most once an hour while Claude Code is in use, and not at all while it is idle. Images are cached for 5 minutes |
| You moved to another time zone for good | Run `/token-heatmap:setup USER --timezone ZONE`. Recorded days stay as they are. Transcripts still on disk are counted again in the new zone, so a response near midnight can count on two days |
| No sync ever runs | Your organization's managed settings can stop plugin hooks (`allowManagedHooksOnly`). Ask whoever manages them |

To sync at once, run `/token-heatmap:status` and ask Claude to sync.

## Uninstall

```sh
claude plugin uninstall token-heatmap@token-heatmap
claude plugin marketplace remove token-heatmap
```

The hooks stop: in new sessions at once, and in sessions that are already open at the start of their next turn. The turn in progress may make one last hook call, which finds no setup and writes nothing. The uninstall deletes the data directory, with `config.json`, `state.json` and the clone.

That leaves what was published. In your profile repository, delete the lines from `<!-- token-heatmap:start -->` to `<!-- token-heatmap:end -->` in `README.md` and the `token-heatmap/` folder, and commit. Earlier commits still hold them; rewriting your repository's history is up to you.

If you install it again later, setup finds your old machine id in `history.jsonl` and stops. Run it with `--adopt ID` to go on with your recorded days.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how to build, test and propose a change, and [docs/providers.md](docs/providers.md) how to add a collector for another tool. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) says. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0](LICENSE).
