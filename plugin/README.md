# token-heatmap

A heatmap of your daily Claude Code token usage in your GitHub profile README, laid out like GitHub's contribution graph: the last 12 months, one square per day, darker for heavier days. Rest the pointer on a day and the browser shows its tokens, such as `96.4M tokens on June 10th.`

It reads the usage Claude Code already records on your machine, and pushes the daily totals and the heatmap to your own profile repository, `USER/USER`, with your own git login. There is no server, no account beyond GitHub, and no telemetry: the developer receives nothing.

Full documentation: <https://github.com/luisegarduno/token-heatmap#readme>. Privacy policy: <https://github.com/luisegarduno/token-heatmap/blob/main/PRIVACY.md>.

## Setup

You need Node.js 20 or later and git on the `PATH` that Claude Code starts with, git able to push to `github.com` without a password prompt (for example after `gh auth setup-git`), and a profile repository with at least one commit.

```text
/token-heatmap:setup USER
```

Setup first prints a plan and changes nothing: the repository, the time zone, how many days of usage it found, and the model names it would publish. It pushes only after you answer yes. Options: `--no-models` publishes counts without model names, `--timezone ZONE` sets the zone that decides each day, `--adopt ID` continues an earlier install's history. `/token-heatmap:status` shows the last sync, what it pushed and the last error.

## What it runs

- **Hooks.** On `SessionStart`, `Stop` and `SessionEnd`, Claude Code runs `"${CLAUDE_PLUGIN_ROOT}/bin/token-heatmap" sync --trigger EVENT`. That shell script checks the Node.js version and runs `node dist/cli.mjs`, which starts a detached copy of itself and returns at once. Before setup, or after an uninstall, the sync finds no `config.json`, writes nothing and exits.
- **The sync.** At most once an hour, or 5 minutes after the last one at a session's end, the detached copy reads the transcripts and runs `git` in its own shallow clone of your profile repository: `ls-remote`, `fetch`, `reset`, and, only if a number changed, one `commit` by `token-heatmap[bot]` and a `push` to the default branch.
- **The code.** `dist/cli.mjs` is an unminified bundle of the TypeScript in [`src/`](https://github.com/luisegarduno/token-heatmap/tree/main/src), built by `npm run build`. CI fails if the bundle differs from a fresh build.

## What it reads

- `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`): from each line it keeps only the line's type, `message.usage`, `message.model`, `message.id`, `requestId`, `sessionId` and `timestamp`, to count each API response once. Prompts, replies, tool calls and file paths are never kept, stored or sent.
- Its own data directory, `~/.claude/plugins/data/token-heatmap-token-heatmap/`: `config.json` (your repository, time zone, machine id and the model-name choice), `state.json` (the last sync's result), `sync.lock`, and `repo/`, the clone.

## What leaves your machine

Only these fields, in `token-heatmap/history.jsonl` in your profile repository on `github.com`. Nothing goes anywhere else.

| Field | What it holds |
| --- | --- |
| `date` | The day, written YYYY-MM-DD, in the time zone set at setup |
| `provider` | The tool the tokens come from: `claude-code` |
| `machine` | A random id of six lowercase letters and digits, made at setup, such as `k3f9a2`. It says nothing about this machine |
| `tokens` | The day's four counts, added up over every model |
| `models` | The same four counts for each model, by model name. Left out with `--no-models` |
| `input`, `output`, `cache_write`, `cache_read` | The four counts in `tokens` and in each model's entry: whole numbers of tokens |

A model name is published as Claude Code records it when it matches `^[A-Za-z0-9._:@-]{1,64}$`; any other name counts under `other`. The heatmap in your README, and its images, are drawn from these fields alone. Each commit, like every git commit, records the time it was made with your machine's offset from UTC.

Your profile repository is public, so all of this is public once pushed, and it stays in that repository's git history.

## Uninstall

```sh
claude plugin uninstall token-heatmap@token-heatmap
claude plugin marketplace remove token-heatmap
```

The hooks stop and the data directory is deleted. To remove what was published, delete the lines from `<!-- token-heatmap:start -->` to `<!-- token-heatmap:end -->` in your profile README and the `token-heatmap/` folder, and commit.

## Support and license

Questions and bugs: <https://github.com/luisegarduno/token-heatmap/issues>. Security problems: report privately, as <https://github.com/luisegarduno/token-heatmap/security/policy> says. Licensed under GPL-3.0-only.
