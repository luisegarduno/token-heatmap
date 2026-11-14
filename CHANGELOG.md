# Changelog

All notable changes to token-heatmap are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.2.0 - 2026-11-14

### Added

- A heatmap of daily Claude Code token usage in a GitHub profile README, centered: the last 12 months, one square per day, five levels by quartile, month labels, a legend and the year's total, legible in GitHub's light and dark themes.
- A tooltip on each day in desktop browsers, such as `96.4M tokens on June 10th.`
- `/token-heatmap:setup`: shows what it will publish, model names included, then clones the profile repository, imports the history still on the machine, and pushes the heatmap in one commit by `token-heatmap[bot]`. Options `--no-models`, `--models`, `--timezone ZONE` and `--adopt ID`.
- Hooks on `SessionStart`, `Stop` and `SessionEnd` that sync at most once an hour while Claude Code is in use, and at a session's end once 5 minutes have passed, in a detached process.
- `/token-heatmap:status`: the last sync, push, skipped hooks and error.
- A Claude Code collector that counts each API response once, on its local day, across the transcript shapes Claude Code has written over time, behind a documented provider interface.
- `token-heatmap/history.jsonl` in the profile repository: the only store, one plain JSON line per day, provider and machine. A recorded day never goes down, so the history outlives Claude Code's transcript cleanup.
- `token-heatmap render --history FILE`, which draws the heatmap from a history file alone.
- Tests that fail if anything but the listed fields reaches the profile repository, or if the README lists other fields.
- The README, a contributing guide, a code of conduct, a security policy, issue and pull request templates, Dependabot, and CI on Ubuntu and macOS with Node.js 20, 22 and 24, with the unit tests on Windows.

[Unreleased]: https://github.com/luisegarduno/token-heatmap/commits/main
