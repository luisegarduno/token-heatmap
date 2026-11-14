# token-heatmap
A token heatmap that can be displayed on your GitHub profile

## Development notes

### Uninstalling the Phase 1 hook probe

Phase 1 installs a throwaway Claude Code plugin, `token-heatmap-probe`, from `scripts/hook-probe/`. That folder is git-ignored and is not part of token-heatmap. While the probe is installed, Claude Code sessions on the machine log their `SessionStart`, `Stop` and `SessionEnd` hook calls to `~/.claude/plugins/data/token-heatmap-probe-token-heatmap-probe/hook-probe.jsonl`. That includes sessions that were already open when it was installed. A line holds the event, the time, the session id, the transcript path, and the `node` and `git` the hook's shell found. It holds no message text.

To uninstall it, run both commands:

```bash
claude plugin uninstall token-heatmap-probe@token-heatmap-probe
claude plugin marketplace remove token-heatmap-probe
```

- The first removes the plugin, its three hooks and the log. Add `--keep-data` to keep the log.
- The second removes the local marketplace that points at `scripts/hook-probe/`.
- `claude plugin list` and `claude plugin marketplace list` then no longer show `token-heatmap-probe`.
- New sessions stop logging at once. A session that was already open may keep the hooks until it is closed.
- A copy of the probe may stay under `~/.claude/plugins/cache/token-heatmap-probe/` for about two weeks. Nothing loads it, and it is safe to delete.
