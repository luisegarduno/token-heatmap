# Privacy policy

Effective 2026-11-14. This policy covers the token-heatmap Claude Code plugin and command line, from <https://github.com/luisegarduno/token-heatmap>.

## In short

token-heatmap runs only on your machine. It has no server, no analytics and no telemetry, and its developer receives no data from it. What it publishes, it publishes with your own git login to your own GitHub profile repository, after you approve it at setup.

## What it reads on your machine

- **Claude Code's transcripts**, in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects`). From each line it keeps only the line's type, the token usage, the model name, the message and request ids, the session id and the timestamp, to count each API response once on its day. It never keeps, stores or sends prompts, replies, tool calls, code, file paths, project or branch names.
- **Its own files**, in `~/.claude/plugins/data/token-heatmap-token-heatmap/`: `config.json` (your profile repository, time zone, a random machine id and whether model names are published), `state.json` (the time and result of the last sync), `sync.lock`, and `repo/`, a clone of your profile repository.

It uses your existing git setup to reach `github.com`. It never reads, stores or sends a token or password itself.

## What leaves your machine

Only these fields, in `token-heatmap/history.jsonl` in your profile repository, `USER/USER` on `github.com`:

| Field | What it holds |
| --- | --- |
| `date` | The day, in the time zone set at setup |
| `provider` | The tool the tokens come from: `claude-code` |
| `machine` | A random id made at setup, such as `k3f9a2`, that says nothing about your machine |
| `tokens` | The day's four counts, added up over every model |
| `models` | The same four counts for each model, by model name. Not published with `--no-models` |
| `input`, `output`, `cache_write`, `cache_read` | Whole numbers of input, output, cache-write and cache-read tokens |

Model names are published as Claude Code records them only when they match `^[A-Za-z0-9._:@-]{1,64}$`; any other name counts under `other`. The heatmap in your README is drawn from these fields alone. Each commit is authored by `token-heatmap[bot]` and, like every git commit, records the time it was made with your machine's offset from UTC.

No other recipient receives anything. A test in the repository, `test/published-fields.test.ts`, fails if anything but these fields reaches the profile repository.

## Who can see it

A GitHub profile repository is public: anyone can read what is pushed, and it stays in that repository's git history. GitHub hosts it under [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## How long it is kept

- **Published data** stays in your profile repository until you remove it. Removing the heatmap and the `token-heatmap/` folder takes it off your profile; earlier commits keep it unless you rewrite the repository's history.
- **Local files** stay until you uninstall. `claude plugin uninstall token-heatmap@token-heatmap` deletes the data directory.
- **Transcripts** belong to Claude Code, which keeps or deletes them by its own settings. token-heatmap never changes or deletes them.

## Your choices

- Setup shows what it will publish, including every model name, and pushes nothing until you say yes.
- `--no-models` publishes counts without model names.
- Uninstalling stops all syncing. The README says how to remove what was published.

## Children

token-heatmap is a developer tool and is not directed at children under 13.

## Changes and contact

Changes to this policy are made in this file, and its history is the record of them. Questions: open an issue at <https://github.com/luisegarduno/token-heatmap/issues>. Privacy or security problems: report privately through the repository's [security policy](SECURITY.md).
