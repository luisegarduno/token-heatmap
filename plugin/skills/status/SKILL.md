---
description: Show when token-heatmap last synced your token heatmap to your GitHub profile, what it pushed, and the last error
---

Show the user the state of token-heatmap's syncs on this machine.

`token-heatmap` is this plugin's own command, and Claude Code puts the plugin's `bin/` on the shell's PATH. If the shell cannot find it, run `"${CLAUDE_PLUGIN_ROOT}/bin/token-heatmap"` instead, with the same arguments. Always pass `--data-dir "${CLAUDE_PLUGIN_DATA}"`: the command cannot find its data directory by itself.

1. Run:

   ```bash
   token-heatmap status --data-dir "${CLAUDE_PLUGIN_DATA}"
   ```

2. Show what it prints, as printed. It changes nothing.
3. If it names an error, say in one sentence what the error says to do. Do not run a fix, a sync or git yourself unless the user asks.

The hooks run a sync at most once an hour while Claude Code is in use, and at a session's end once 5 minutes have passed. To sync now, the user can run `token-heatmap sync --foreground --data-dir "${CLAUDE_PLUGIN_DATA}"`; offer it only when they ask.
