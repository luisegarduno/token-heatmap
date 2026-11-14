# Security policy

token-heatmap runs on your machine with your privileges: its hooks run outside Claude Code's sandbox, it reads your Claude Code transcripts, and it pushes to your GitHub profile repository with your own git credentials. A bug in it can leak what is in those transcripts or misuse that access, so security reports are taken seriously.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/luisegarduno/token-heatmap/security/advisories/new)** (the "Security" tab of this repository, then "Report a vulnerability").

Please do not open a public issue, pull request or discussion for it. Include:

- what an attacker, or the bug, can do, and to whom,
- the steps to reproduce it, with made-up data: never real transcripts or usage,
- the versions of token-heatmap, Claude Code, Node.js and git, and your operating system.

The maintainer will acknowledge the report, keep you informed while it is fixed, and credit you in the advisory unless you would rather not be named. Please give a reasonable time for a fix before you disclose it.

## What counts

In scope, for example:

- **Anything published beyond the listed fields.** The README's "What leaves your machine" lists exactly what may be pushed. A prompt, a reply, a file path, a project name or any other data from the transcripts reaching the profile repository is a vulnerability, even when it takes an unusual transcript to get there.
- Markup or script from a transcript reaching the README block.
- A command or argument injection in the launcher, the hooks, the skills or the git commands.
- A push to any repository other than the configured profile repository, a force push, or a commit that is not `token-heatmap[bot]`'s.
- Exposure of git credentials, or a credential prompt that a detached sync opens.

Out of scope:

- The numbers being self-reported. Anyone who controls their own profile repository can edit their history, and token-heatmap does not claim the numbers are genuine.
- What is public by design: the listed fields, in a public profile repository.
- Problems in Claude Code, GitHub, Node.js or git themselves. Report those to their projects.

## Supported versions

Fixes go into the latest release. Before 1.0.0, only the newest version is supported.
