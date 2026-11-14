// The docs say what the code does: the README lists exactly the fields that leave the machine,
// its example history line reads back, its commands name this repository's marketplace and
// plugin, and every manifest holds one version.

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { END, START } from "../src/readme.ts"
import { formatHistory, parseHistory } from "../src/store.ts"
import { COUNT_KEYS, LINE_KEYS, MODEL_RULE, OTHER_MODEL } from "./published.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const json = (path: string) => JSON.parse(read(path))
const README = read("README.md")

/** The text under a "## " heading of `markdown`, up to the next one. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n")
  const start = lines.indexOf(`## ${heading}`)
  assert.ok(start >= 0, `a "## ${heading}" heading`)
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "))
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n")
}

/** The first cell of each row of the first table in `markdown`, below its header and separator. */
function firstColumn(markdown: string): string[] {
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => line.startsWith("|"))
  assert.ok(start >= 0, "a table")
  const end = lines.findIndex((line, i) => i > start && !line.startsWith("|"))
  return lines.slice(start + 2, end < 0 ? undefined : end).map((row) => row.split("|")[1])
}

const codeSpans = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1])

// README.md, the plugin folder's own README (the plugin directory's listing) and the privacy policy
// each say what leaves the machine, under the same heading.
const FIELD_DOCS = ["README.md", "plugin/README.md", "PRIVACY.md"]

for (const doc of FIELD_DOCS) {
  test(`${doc} lists exactly the fields that published-fields.test.ts lets leave the machine`, () => {
    const listed = firstColumn(section(read(doc), "What leaves your machine")).flatMap(codeSpans)
    assert.equal(new Set(listed).size, listed.length, `a field listed twice: ${listed.join(", ")}`)
    assert.deepEqual([...listed].sort(), [...LINE_KEYS, ...COUNT_KEYS].sort())
  })

  test(`${doc} gives the rule for a published model name, and where the others go`, () => {
    const text = section(read(doc), "What leaves your machine")
    assert.ok(text.includes(`\`${MODEL_RULE.source}\``), `the rule ${MODEL_RULE.source}`)
    assert.ok(text.includes(`\`${OTHER_MODEL}\``), `"${OTHER_MODEL}"`)
  })
}

test("the plugin folder's README names every hook command and the plugin's commands", () => {
  const text = read("plugin/README.md")
  const hooks = json("plugin/hooks/hooks.json").hooks as Record<string, { hooks: { command: string }[] }[]>
  for (const [event, groups] of Object.entries(hooks)) {
    assert.ok(text.includes(`\`${event}\``), event)
    for (const { command } of groups.flatMap((group) => group.hooks)) {
      assert.ok(text.includes(command.replace(/--trigger \w+$/, "--trigger EVENT")), command)
    }
  }
  const plugin = json("plugin/.claude-plugin/plugin.json")
  const marketplace = json(".claude-plugin/marketplace.json")
  for (const command of [
    `/${plugin.name}:setup`,
    `/${plugin.name}:status`,
    `claude plugin uninstall ${plugin.name}@${marketplace.name}`,
  ]) {
    assert.ok(text.includes(command), command)
  }
  // The listing is shown away from this repository, so its links are absolute.
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) assert.match(target, /^https:\/\//, target)
})

test("the README's example history line reads back, and is written as token-heatmap writes it", () => {
  const blocks = [...section(README, "The history file").matchAll(/```json\n([^`]*)```/g)].map((match) => match[1])
  assert.equal(blocks.length, 1)
  const [example] = blocks
  const lines = parseHistory(example)
  assert.equal(lines.length, 1)
  assert.equal(formatHistory(lines), example)
  assert.deepEqual(Object.keys(lines[0]), LINE_KEYS)
})

test("the README's marker lines are the ones setup adds and sync looks for", () => {
  const markers = `\`\`\`html\n${START}\n${END}\n\`\`\``
  assert.ok(README.includes(markers), markers)
})

test("the README's commands name this repository, its marketplace, its plugin and its skills", () => {
  const repository = /github\.com\/([^/]+\/[^/.]+)/.exec(json("package.json").repository.url)?.[1]
  const marketplace = json(".claude-plugin/marketplace.json")
  const plugin = json("plugin/.claude-plugin/plugin.json")
  assert.ok(marketplace.plugins.some((entry: { name: string }) => entry.name === plugin.name))
  const id = `${plugin.name}@${marketplace.name}`
  for (const command of [
    `claude plugin marketplace add ${repository}`,
    `claude plugin install ${id}`,
    `claude plugin uninstall ${id}`,
    `claude plugin marketplace remove ${marketplace.name}`,
    `git clone https://github.com/${repository}`,
  ]) {
    assert.ok(README.includes(command), command)
  }
  for (const skill of ["setup", "status"]) {
    assert.ok(existsSync(join(ROOT, "plugin", "skills", skill, "SKILL.md")), `the ${skill} skill`)
    assert.ok(README.includes(`/${plugin.name}:${skill}`), `/${plugin.name}:${skill}`)
  }
})

test("package.json, package-lock.json, plugin.json and marketplace.json hold one version", () => {
  const pkg = json("package.json")
  const lock = json("package-lock.json")
  const plugin = json("plugin/.claude-plugin/plugin.json")
  const entry = json(".claude-plugin/marketplace.json").plugins.find((p: { name: string }) => p.name === plugin.name)
  const versions = {
    "package.json": pkg.version,
    "package-lock.json": lock.version,
    'package-lock.json packages[""]': lock.packages[""].version,
    "plugin.json": plugin.version,
    "marketplace.json": entry?.version,
  }
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  for (const [where, version] of Object.entries(versions)) assert.equal(version, pkg.version, where)
})

test("every relative link in the docs leads to a file or a heading that exists", () => {
  const docs = [
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "PRIVACY.md",
    "docs/providers.md",
    "plugin/README.md",
  ]
  for (const doc of docs) {
    const text = read(doc)
    const slugs = new Set(
      [...text.matchAll(/^#+ (.+)$/gm)].map((match) =>
        match[1]
          .toLowerCase()
          .replace(/[^\p{L}\p{N} _-]/gu, "")
          .replace(/ /g, "-"),
      ),
    )
    // Markdown links, and the src and srcset of an HTML image outside a code block.
    const prose = text.replace(/^```[\s\S]*?^```$/gm, "")
    const targets = [
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]),
      ...[...prose.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((match) => match[1]),
    ]
    for (const target of targets) {
      if (/^[a-z]+:/.test(target)) continue
      if (target.startsWith("#")) {
        assert.ok(slugs.has(target.slice(1)), `${doc}: ${target}`)
        continue
      }
      const path = join(ROOT, dirname(doc), target.split("#")[0])
      assert.ok(existsSync(path), `${doc}: ${target}`)
    }
  }
})

test("every test file that npm run test:unit names exists", () => {
  const script: string = json("package.json").scripts["test:unit"]
  const files = script.split(/\s+/).filter((arg) => arg.endsWith(".test.ts"))
  assert.ok(files.length > 0)
  for (const file of files) assert.ok(existsSync(join(ROOT, file)), file)
})
