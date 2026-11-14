---
description: Put your Claude Code token heatmap on your GitHub profile
disable-model-invocation: true
argument-hint: "[github-user] [--timezone ZONE] [--no-models] [--adopt ID]"
---

Set up token-heatmap: a heatmap of this machine's daily Claude Code tokens in the README of the user's GitHub profile repository, USER/USER.

`token-heatmap` is this plugin's own command, and Claude Code puts the plugin's `bin/` on the shell's PATH. If the shell cannot find it, run `"${CLAUDE_PLUGIN_ROOT}/bin/token-heatmap"` instead, with the same arguments. Always pass `--data-dir "${CLAUDE_PLUGIN_DATA}"` as below: the command cannot find its data directory by itself.

1. The GitHub user name is the first word of `$ARGUMENTS` that does not start with `--`. If there is none, ask the user for it and wait for the answer.
2. Run this, with the user name for USER and every flag from `$ARGUMENTS` (`--timezone ZONE`, `--no-models`, `--models`, `--adopt ID`) added, but never `--yes`:

   ```bash
   token-heatmap setup --data-dir "${CLAUDE_PLUGIN_DATA}" --repo USER
   ```

   It changes nothing. Show the user the plan it prints, as printed, with the model names. Then ask whether to publish it, and wait for the answer. What is pushed stays in the repository's git history, so the user decides; do not answer for them.
3. Only on a yes, run the same command again with `--yes` added, and show what it prints.
4. If a run fails, show its message as printed, then:
   - **The push was refused.** The message ends with the fix, such as `gh auth setup-git`. Offer to run it, and after it, step 3 again.
   - **The history holds the lines of another machine.** Ask the user whether those lines are this machine's own, from an earlier install. Only on a yes, run step 3 with `--adopt ID` added, where ID is the id the message names and the user confirms. Never pick an id yourself.
   - **Anything else.** Stop, and leave the fix to the user.

`token-heatmap setup` is the only thing that writes the data directory: do not edit `config.json` there, and do not run git in its `repo/` unless the user asks for a fix that setup printed.
