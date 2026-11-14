// replaceBlock(): the block between the two markers of the profile README. withMarkers(): the
// markers setup adds at the end of a README that has none.

import assert from "node:assert/strict"
import { test } from "node:test"
import { END, MarkersError, replaceBlock, START, withMarkers } from "../src/readme.ts"

const before = "# Hi\n\nMy own text, with <b>HTML</b> of my own.\n\n"
const after = "\n\nMore of my own text.\n"

test("replaces the text between the markers, and leaves the rest byte for byte", () => {
  const readme = `${before}${START}\nan old block\nover two lines\n${END}${after}`
  assert.equal(replaceBlock(readme, "<table>new</table>"), `${before}${START}\n<table>new</table>\n${END}${after}`)
})

test("fills empty markers, and gives the same README when run again", () => {
  const empty = `${before}${START}${END}${after}`
  const once = replaceBlock(empty, "block")
  assert.equal(once, `${before}${START}\nblock\n${END}${after}`)
  assert.equal(replaceBlock(once, "block"), once)
  assert.equal(replaceBlock(`${START}\n${END}`, "block"), `${START}\nblock\n${END}`)
})

test("the markers can sit anywhere, and only the first pair is used", () => {
  const readme = `${before}| ${START} | ${END} |${after}${START}\nsecond\n${END}\n`
  assert.equal(replaceBlock(readme, "x"), `${before}| ${START}\nx\n${END} |${after}${START}\nsecond\n${END}\n`)
})

test("the block goes in as it is, $ signs and all", () => {
  const block = "$& $1 $$ $` $'"
  assert.equal(replaceBlock(`${START}${END}`, block), `${START}\n${block}\n${END}`)
})

test("markers missing: throws a MarkersError that names them", () => {
  for (const readme of [
    "",
    `${before}${after}`,
    `${before}${START}${after}`,
    `${before}${END}${after}`,
    `${END}\n${START}`,
    `${before}<!-- token-heatmap:begin -->\n<!-- token-heatmap:end -->`,
  ]) {
    assert.throws(
      () => replaceBlock(readme, "block"),
      (error) =>
        error instanceof MarkersError &&
        error.message ===
          'README.md has no "<!-- token-heatmap:start -->" line followed by an "<!-- token-heatmap:end -->" line, so the block has nowhere to go',
      JSON.stringify(readme),
    )
  }
})

test("withMarkers: a README with neither marker gets both at its end, after a blank line", () => {
  const markers = `${START}\n${END}\n`
  assert.equal(withMarkers(""), markers)
  assert.equal(withMarkers("# Hi"), `# Hi\n\n${markers}`)
  assert.equal(withMarkers("# Hi\n"), `# Hi\n\n${markers}`)
  assert.equal(withMarkers("# Hi\n\n"), `# Hi\n\n${markers}`)
  assert.equal(withMarkers("# Hi\n\n\n"), `# Hi\n\n\n${markers}`)
  // The owner's own text stays byte for byte, and the block then goes between the new markers.
  const own = `${before}${after}`
  const added = withMarkers(own)
  assert.ok(added.startsWith(own))
  assert.equal(replaceBlock(added, "block"), `${own}\n${START}\nblock\n${END}\n`)
})

test("withMarkers: a README replaceBlock can use is left as it is, and so is the one it gives back", () => {
  for (const readme of [
    `${before}${START}${END}${after}`,
    `${before}${START}\nan old block\n${END}${after}`,
    `${END}\n${before}${START}\n${END}`,
    `${START}\n${END}\n${START}`,
  ]) {
    assert.equal(withMarkers(readme), readme, JSON.stringify(readme))
  }
  const once = withMarkers(`${before}${after}`)
  assert.equal(withMarkers(once), once)
})

test("withMarkers: one marker without the other throws, rather than take the owner's text into the block", () => {
  const cases: [string, RegExp][] = [
    [
      `${before}${START}${after}`,
      /^README\.md has a "<!-- token-heatmap:start -->" line with no "<!-- token-heatmap:end -->" line after it\. /,
    ],
    [
      `${END}\n${before}${START}`,
      /^README\.md has a "<!-- token-heatmap:start -->" line with no "<!-- token-heatmap:end -->" line after it\. /,
    ],
    [
      `${before}${END}${after}`,
      /^README\.md has a "<!-- token-heatmap:end -->" line with no "<!-- token-heatmap:start -->" line before it\. /,
    ],
  ]
  for (const [readme, message] of cases) {
    assert.throws(
      () => withMarkers(readme),
      (error) => error instanceof MarkersError && message.test(error.message),
      JSON.stringify(readme),
    )
  }
})
