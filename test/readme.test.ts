// replaceBlock(): the block between the two markers of the profile README.

import assert from "node:assert/strict"
import { test } from "node:test"
import { END, MarkersError, replaceBlock, START } from "../src/readme.ts"

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
