# Contributing to token-heatmap

Thanks for helping. Bug reports, fixes, docs and collectors for other tools are all welcome. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

For a large change, or one that changes what leaves the user's machine, open an issue first so we can agree on the approach before you write it.

## Setting up

You need Node.js 20 or later, npm and git. macOS or Linux runs everything; Windows runs the unit tests only.

```sh
git clone https://github.com/luisegarduno/token-heatmap
cd token-heatmap
npm ci
npm run check
```

`npm run check` is what CI runs. It must pass before a pull request is merged.

| Script | What it does |
| --- | --- |
| `npm run lint` | Biome's lint and format checks |
| `npm run format` | Biome's fixes, written to the files |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Bundles `src/cli.ts` into `plugin/dist/cli.mjs` with esbuild |
| `npm test` | Every test in `test/*.test.ts`, with `node:test` |
| `npm run test:unit` | The tests that need neither git nor `sh`, as the Windows job runs them |
| `npm run check` | Lint, typecheck, build, test, then a failure if the committed bundle differs from the fresh build |

## How the repository is laid out

```text
.claude-plugin/marketplace.json   the marketplace: one plugin, in ./plugin
plugin/                           the only directory a user's machine receives
  .claude-plugin/plugin.json
  bin/token-heatmap(.cmd)         the launcher: finds node, runs dist/cli.mjs
  dist/cli.mjs                    the bundle, committed
  hooks/hooks.json                SessionStart, Stop and SessionEnd run `token-heatmap sync`
  skills/setup, skills/status     /token-heatmap:setup and /token-heatmap:status
  assets/                         the heatmap's images
src/
  cli.ts                          render, sync, status, setup
  providers/                      collect: the Provider interface and the Claude Code collector
  store.ts                        history.jsonl: read, merge, write
  levels.ts  render.ts            draw: history to the README block
  readme.ts                       the block between the two markers
  publish/git-readme.ts           publish: the only module that runs git
  config.ts  state.ts  setup.ts  sync.ts
test/                             node:test, with made-up data written inline
docs/providers.md                 how to add a collector for another tool
```

`package.json` and its lockfile hold only dev tools, and the plugin has no runtime dependencies. Claude Code installs a plugin by copying its directory, and would install npm packages for one that has a `package.json` at its root, so everything a user needs is in `plugin/`.

## The bundle is committed

A plugin installs from git, so `plugin/dist/cli.mjs` is committed. When you change anything under `src/`, run `npm run build` and commit the new bundle in the same commit. `npm run check` fails while the committed bundle differs from the build. A Dependabot pull request that updates esbuild may need the same.

## Tests

- **Every value is made up.** Never copy a real transcript, history file, usage number, file path, user name, machine id or model list into a test or a fixture. Write transcripts inline in the test, as `test/claude-code.test.ts` does, with the helpers in `test/helpers.ts`.
- **Nothing reaches the network or your machine's own data.** Importing `test/helpers.ts` gives the test process an empty temporary home directory, an empty git config and no `CLAUDE_CONFIG_DIR`. A profile repository is a bare repository in a temporary directory, and `onGitHub()` routes setup's github.com addresses to it.
- **One test per rule.** Name a test after the rule it checks. When you add a rule, break it once in the code and make sure its test fails.
- **The renderer is held to a fixture.** `test/fixtures/block.html` is the block that was checked on a real profile, in several browsers and on phones. If you change the block, check it on GitHub the same way before you change the fixture.
- **What leaves the machine is held to a list.** `test/published.ts` lists the published fields. `test/published-fields.test.ts` fails if a sync or a setup publishes anything else, and `test/docs.test.ts` fails if the README's "What leaves your machine" lists other fields. Change the three together, and say why in the pull request.

Tests that run `sh` or git skip themselves on Windows, and `npm run test:unit` leaves them out.

## Trying the plugin

`render` needs no setup:

```sh
plugin/bin/token-heatmap render --history test/fixtures/history.jsonl --today 2026-11-13
```

The plugin itself pushes to a real profile repository, and what it pushes stays in that repository's git history. To try a change from your working tree, add it as a local marketplace:

```sh
claude plugin marketplace add ./
claude plugin install token-heatmap@token-heatmap
```

A plugin added from a local path runs from that path, so your edits take effect after `npm run build`. Its hooks reach sessions that are already open from their next turn. If you have it installed from GitHub too, uninstall that first: both marketplaces are named `token-heatmap`.

To run a sync against a scratch repository instead of your profile, give it its own data directory: `plugin/bin/token-heatmap sync --foreground --data-dir DIR` reads `DIR/config.json` and pushes to the clone in `DIR/repo`, whose `origin` can be any bare repository on disk.

## Style

- TypeScript, strict, run by Node.js 20 or later with no runtime dependencies. Biome formats it: run `npm run format`.
- Comments and messages say what is true and what to do, in plain words. An error message names the file or setting at fault and the fix.
- Only `src/publish/git-readme.ts` runs git, and only collectors in `src/providers/` know a tool's data.

## Commits and pull requests

- Keep each commit to one change, with a message in the form the history uses: `type(scope): what it does`, such as `fix(collect): count a response copied by a fork once`. Types in use: `feat`, `fix`, `test`, `docs`, `chore`.
- Fill in the pull request template. CI runs on Ubuntu and macOS with Node.js 20, 22 and 24, and the unit tests on Windows. `main` takes changes through pull requests whose checks pass.
- Add a line under "Unreleased" in `CHANGELOG.md` for a change users will notice.

## License

token-heatmap is under the [GPL-3.0](LICENSE). By contributing, you agree that your contribution is released under the same license.
