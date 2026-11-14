import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import type { HistoryLine, Tokens } from "../src/providers/provider.ts"
import { IMAGE_FILES, render } from "../src/render.ts"
import { parseHistory } from "../src/store.ts"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const HISTORY = parseHistory(read("fixtures/history.jsonl"))
const BLOCK = read("fixtures/block.html")
const TODAY = "2026-11-13"

// ---------------------------------------------------------------------------------------------
// Dates, written out here rather than taken from src/render.ts.
// ---------------------------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY
const isoOf = (day: number) => new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
const MONTHS = "January February March April May June July August September October November December".split(" ")
// 1st to 31st
const SUFFIXES = "st nd rd th th th th th th th th th th th th th th th th th st nd rd th th th th th th th st".split(
  " ",
)
const spoken = (day: number) => {
  const date = new Date(day * MS_PER_DAY)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}${SUFFIXES[date.getUTCDate() - 1]}`
}

const tokens = (cache_read: number, input = 0): Tokens => ({ input, output: 0, cache_write: 0, cache_read })
const line = (date: string, t: Tokens, machine = "k3f9a2", provider = "claude-code"): HistoryLine => ({
  date,
  provider,
  machine,
  tokens: t,
})

// ---------------------------------------------------------------------------------------------
// Taking a block apart. parseBlock checks the shape every block has, and returns the headline,
// the day cells in date order, and the files of the month row.
// ---------------------------------------------------------------------------------------------

type Image = { file: string; width: number; height: number; hspace: number; title: string | undefined }
type Cell = { level: number; title: string }

const LINK =
  /<a href="token-heatmap\/history\.jsonl"(?: title="([^"]*)")? tabindex="-1"><img src="token-heatmap\/([a-z0-9-]+)\.svg" width="(\d+)" height="(\d+)"(?: hspace="(\d+)")? align="top" alt=""><\/a>/g
const FRAME =
  /^<table><tr><td nowrap>\n(<b>[^<]*<\/b> Claude Code tokens? in the last year)<br>\n<kbd>(.*)<\/kbd>\n<\/td><\/tr><\/table>$/s
const WEEKDAY_LABELS = ["gap-30x14", "mon", "gap-30x14", "wed", "gap-30x14", "fri", "gap-30x14"]
const LEGEND = ["gap-158x14", "gap-158x14", "gap-158x14", "gap-158x14", "less", "0", "1", "2", "3", "4", "more"]
const GRID_WIDTH = 772

function parseBlock(block: string): { headline: string; cells: Cell[]; months: string[]; images: Image[] } {
  const frame = FRAME.exec(block)
  assert.ok(frame, "the frame around the grid")
  const rows = frame[2].split("<br\n>").map((row) => {
    const links = [...row.matchAll(LINK)]
    assert.equal(links.map((m) => m[0]).join(""), row, "a row is linked images and nothing else")
    return links.map(
      ([, title, file, width, height, hspace]): Image => ({
        file,
        width: Number(width),
        height: Number(height),
        hspace: Number(hspace ?? 0),
        title,
      }),
    )
  })
  assert.equal(rows.length, 10, "months, Sunday to Saturday, the row that holds the frame open, the legend")
  const width = (row: Image[]) => row.reduce((sum, x) => sum + x.width + 2 * x.hspace, 0)
  const [months, ...rest] = rows
  const weekdays = rest.slice(0, 7)
  const [hold, legend] = rest.slice(7)

  assert.equal(width(months), GRID_WIDTH, "month row width")
  assert.equal(months[0].file, "gap-30x16")
  assert.deepEqual(hold, [{ file: "gap-2x2", width: 2, height: 2, hspace: 385, title: undefined }])
  assert.deepEqual(
    legend.map((x) => x.file),
    LEGEND,
  )
  assert.equal(width(legend), GRID_WIDTH, "legend width")
  assert.ok([...months, ...legend].every((x) => x.title === undefined && x.hspace === 0))

  const cells: Cell[] = []
  weekdays.forEach((row, r) => {
    const [label, ...days] = row
    assert.deepEqual([label.file, label.title, label.hspace], [WEEKDAY_LABELS[r], undefined, 0], `row ${r} label`)
    assert.equal(width(row), 30 + 14 * days.length, `row ${r} width`)
    days.forEach((x, c) => {
      assert.match(x.file, /^[0-4]$/, "a day is one of the five levels")
      assert.ok(x.title !== undefined && x.hspace === 0, "a day has a title")
      cells[7 * c + r] = { level: Number(x.file), title: x.title }
    })
  })
  // Sunday's row has 53 days and Saturday's 52 or 53; no row has more than the row above, so the
  // cells run unbroken from the first Sunday to today.
  const lengths = weekdays.map((row) => row.length - 1)
  assert.equal(lengths[0], 53, "Sunday's row")
  assert.ok(
    lengths.every((n, r) => (n === 53 || n === 52) && (r === 0 || n <= lengths[r - 1])),
    `${lengths}`,
  )
  assert.equal(
    cells.length,
    lengths.reduce((a, b) => a + b),
  )
  assert.ok(cells.every(Boolean), "no hole in the grid")

  return { headline: frame[1], cells, months: months.map((x) => x.file), images: rows.flat() }
}

/** The month row for a window, from the months of its Sundays: the rule of the block, written out again. */
function monthRowFor(firstSunday: number): string[] {
  const month = (column: number) => new Date((firstSunday + 7 * column) * MS_PER_DAY).getUTCMonth()
  const files = ["gap-30x16"]
  for (let c = 0; c < 53; ) {
    let run = 1
    while (c + run < 53 && month(c + run) === month(c)) run++
    if (run === 1) files.push("gap-14x16")
    else files.push(MONTHS[month(c)].slice(0, 3).toLowerCase(), ...(run > 2 ? [`gap-${14 * (run - 2)}x16`] : []))
    c += run
  }
  return files
}

// GitHub kept these in Phase 1's test, and removed `style`, `class`, inline <svg> and data:
// addresses. `hspace` was measured there too.
const KEPT: Record<string, readonly string[]> = {
  table: [],
  tr: [],
  td: ["nowrap"],
  b: [],
  br: [],
  kbd: [],
  a: ["href", "title", "tabindex"],
  img: ["src", "width", "height", "hspace", "align", "alt"],
}

function assertKeptByGitHub(block: string) {
  const tag = /<(\/?)([a-z]+)((?:\s+[a-z]+(?:="[^"<>]*")?)*)\s*>/g
  for (const [, closing, name, attributes] of block.matchAll(tag)) {
    assert.ok(Object.hasOwn(KEPT, name), `GitHub keeps <${name}>`)
    const names = [...attributes.matchAll(/([a-z]+)(?:="[^"]*")?/g)].map((m) => m[1])
    if (closing) assert.deepEqual(names, [], `</${name}> has no attributes`)
    for (const attribute of names) assert.ok(KEPT[name].includes(attribute), `GitHub keeps ${attribute} on <${name}>`)
  }
  assert.doesNotMatch(block.replace(tag, ""), /[<>&"']/, "no markup outside the tags")
}

// ---------------------------------------------------------------------------------------------
// The made-up year
// ---------------------------------------------------------------------------------------------

test("the made-up year, today 2026-11-13: equal to block.html, byte for byte", () => {
  // block.html ends with the newline that `token-heatmap render` prints after the block.
  assert.equal(`${render(HISTORY, TODAY)}\n`, BLOCK)
})

test("the made-up year: every cell's level, every tooltip and the total", () => {
  const { headline, cells, months } = parseBlock(render(HISTORY, TODAY))
  assert.equal(headline, "<b>9.18B</b> Claude Code tokens in the last year")
  const first = dayOf("2025-11-09")
  assert.deepEqual(
    cells.map((cell, i) => `${isoOf(first + i)} ${cell.level} ${cell.title}`),
    days().trim().split("\n"),
  )
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((level) => cells.filter((cell) => cell.level === level).length),
    [114, 64, 64, 64, 64],
  )
  assert.deepEqual(months, monthRowFor(first))
})

// ---------------------------------------------------------------------------------------------
// Other histories
// ---------------------------------------------------------------------------------------------

test("no history, and a year of zero days: a full grid at level 0, with No tokens on every cell", () => {
  const first = dayOf("2025-11-09")
  const zeros = Array.from({ length: 370 }, (_, i) => line(isoOf(first + i), tokens(0)))
  const empty = render([], TODAY)
  assert.equal(render(zeros, TODAY), empty)
  const { headline, cells } = parseBlock(empty)
  assert.equal(headline, "<b>0</b> Claude Code tokens in the last year")
  assert.deepEqual(
    cells,
    Array.from({ length: 370 }, (_, i) => ({ level: 0, title: `No tokens on ${spoken(first + i)}.` })),
  )
})

test("a day of exactly one token reads 1 token", () => {
  const one = parseBlock(render([line("2026-11-12", tokens(0, 1))], TODAY))
  assert.equal(one.headline, "<b>1</b> Claude Code token in the last year")
  assert.deepEqual(one.cells[368], { level: 1, title: "1 token on November 12th." })

  const two = parseBlock(render([line("2026-11-12", tokens(1, 1))], TODAY))
  assert.equal(two.headline, "<b>2</b> Claude Code tokens in the last year")
  assert.deepEqual(two.cells[368], { level: 1, title: "2 tokens on November 12th." })
})

test("a tooltip rounds to one decimal and the headline to two; halves round up", () => {
  const shown = (n: number) => {
    const { headline, cells } = parseBlock(render([line("2026-11-12", tokens(n))], TODAY))
    return [headline.slice(3, headline.indexOf("</b>")), cells[368].title.slice(0, cells[368].title.indexOf(" "))]
  }
  const cases: [number, string, string][] = [
    [2, "2", "2"],
    [412, "412", "412"],
    [999, "999", "999"],
    [1000, "1.00K", "1.0K"],
    [1049, "1.05K", "1.0K"],
    [1050, "1.05K", "1.1K"],
    [684_531, "684.53K", "684.5K"],
    [999_949, "999.95K", "999.9K"],
    [999_950, "999.95K", "1.0M"],
    [999_994, "999.99K", "1.0M"],
    [999_995, "1.00M", "1.0M"],
    [1_000_000, "1.00M", "1.0M"],
    [96_412_870, "96.41M", "96.4M"],
    [999_949_999, "999.95M", "999.9M"],
    [999_950_000, "999.95M", "1.0B"],
    [999_995_000, "1.00B", "1.0B"],
    [1_284_300_112, "1.28B", "1.3B"],
    [9_182_417_306, "9.18B", "9.2B"],
    [1_234_567_890_123, "1234.57B", "1234.6B"],
  ]
  assert.deepEqual(
    cases.map(([n]) => [n, ...shown(n)]),
    cases,
  )
})

test("a date's lines are added, from every provider and machine; lines outside the window count nowhere", () => {
  const history = [
    line("2025-11-08", tokens(5_000_000)), // the day before the window
    line("2026-11-12", tokens(100)),
    line("2026-11-12", tokens(20, 3), "p7m2x1"),
    line("2026-11-12", tokens(1000), "k3f9a2", "another-provider"),
    line("2026-11-14", tokens(7_000_000)), // the day after today
  ]
  const { headline, cells } = parseBlock(render(history, TODAY))
  assert.equal(headline, "<b>1.12K</b> Claude Code tokens in the last year")
  assert.deepEqual(cells[368], { level: 1, title: "1.1K tokens on November 12th." })
  assert.ok(cells.every((cell, i) => i === 368 || cell.level === 0))
})

test("today must be a day written YYYY-MM-DD", () => {
  for (const today of ["2026-02-30", "20261113", "2026-11-13T00:00:00Z", ""]) {
    assert.throws(() => render([], today), /today is not a day written YYYY-MM-DD/, today)
  }
})

// ---------------------------------------------------------------------------------------------
// Every block
// ---------------------------------------------------------------------------------------------

// Two years of todays: windows of every length from 365 to 371 days, that start in each month,
// and that hold 2028-02-29.
const TODAYS = Array.from({ length: dayOf("2028-12-31") - dayOf("2027-01-01") + 1 }, (_, i) =>
  isoOf(dayOf("2027-01-01") + i),
)

test("every today in 2027 and 2028: the Sunday 52 weeks before today's week, through today", () => {
  for (const today of TODAYS) {
    const last = dayOf(today)
    const days = 365 + new Date(last * MS_PER_DAY).getUTCDay()
    const first = last - days + 1
    const { cells, months } = parseBlock(render([], today))
    assert.equal(cells.length, days, today)
    assert.equal(new Date(first * MS_PER_DAY).getUTCDay(), 0, `${today}: the grid starts on a Sunday`)
    assert.ok(
      cells.every((cell, i) => cell.level === 0 && cell.title === `No tokens on ${spoken(first + i)}.`),
      today,
    )
    assert.deepEqual(months, monthRowFor(first), today)
  }
})

test("any output holds only tags and attributes that GitHub keeps", () => {
  const blocks = [
    render(HISTORY, TODAY),
    render([], TODAY),
    render([line("2026-11-12", tokens(0, 1))], TODAY),
    ...TODAYS.map((today) => render(HISTORY, today)),
  ]
  for (const block of blocks) assertKeptByGitHub(block)
})

test("each image's width and height are its file's own, and every file in plugin/assets is used", () => {
  const assets = new URL("../plugin/assets/", import.meta.url)
  const used = new Map<string, string>()
  for (const today of [TODAY, ...TODAYS]) {
    for (const x of parseBlock(render(HISTORY, today)).images) used.set(x.file, `${x.width}x${x.height}`)
  }
  const files = readdirSync(assets).filter((name) => name.endsWith(".svg"))
  assert.deepEqual([...used.keys()].sort(), files.map((name) => name.slice(0, -4)).sort())
  // What setup copies to the profile repository: the same files, each once.
  assert.deepEqual([...IMAGE_FILES].sort(), [...files].sort())
  for (const [file, size] of used) {
    const svg = readFileSync(new URL(`${file}.svg`, assets), "utf8")
    const match = /^<svg [^>]*\bwidth="(\d+)" height="(\d+)"/.exec(svg)
    assert.ok(match, `${file}.svg has a width and a height`)
    assert.equal(`${match[1]}x${match[2]}`, size, `${file}.svg`)
  }
})

test("render reads no clock and does no I/O", () => {
  // render.ts and everything it imports.
  for (const file of ["render.ts", "levels.ts", "store.ts", "providers/provider.ts"]) {
    const source = read(`../src/${file}`)
    for (const [, from] of source.matchAll(/^import .* from "([^"]+)"/gm)) {
      assert.ok(from.startsWith("./") || from.startsWith("../"), `${file} imports ${from}`)
    }
    assert.doesNotMatch(source, /Date\.now|new Date\(\)|process\.|performance\.|Math\.random|\brequire\(/, file)
  }
})

// ---------------------------------------------------------------------------------------------
// Each day of the made-up year as block.html shows it: date, level, tooltip. Taken from
// block.html itself, the block that passed on GitHub.
// ---------------------------------------------------------------------------------------------

function days() {
  return `
2025-11-09 3 30.6M tokens on November 9th.
2025-11-10 0 No tokens on November 10th.
2025-11-11 0 No tokens on November 11th.
2025-11-12 1 1.2M tokens on November 12th.
2025-11-13 3 33.2M tokens on November 13th.
2025-11-14 0 No tokens on November 14th.
2025-11-15 0 No tokens on November 15th.
2025-11-16 0 No tokens on November 16th.
2025-11-17 0 No tokens on November 17th.
2025-11-18 1 2.4M tokens on November 18th.
2025-11-19 0 No tokens on November 19th.
2025-11-20 2 6.4M tokens on November 20th.
2025-11-21 1 395.1K tokens on November 21st.
2025-11-22 0 No tokens on November 22nd.
2025-11-23 0 No tokens on November 23rd.
2025-11-24 0 No tokens on November 24th.
2025-11-25 0 No tokens on November 25th.
2025-11-26 3 22.2M tokens on November 26th.
2025-11-27 0 No tokens on November 27th.
2025-11-28 0 No tokens on November 28th.
2025-11-29 0 No tokens on November 29th.
2025-11-30 0 No tokens on November 30th.
2025-12-01 2 15.2M tokens on December 1st.
2025-12-02 0 No tokens on December 2nd.
2025-12-03 1 1.7M tokens on December 3rd.
2025-12-04 4 95.5M tokens on December 4th.
2025-12-05 0 No tokens on December 5th.
2025-12-06 0 No tokens on December 6th.
2025-12-07 1 2.7M tokens on December 7th.
2025-12-08 2 8.1M tokens on December 8th.
2025-12-09 0 No tokens on December 9th.
2025-12-10 2 9.5M tokens on December 10th.
2025-12-11 0 No tokens on December 11th.
2025-12-12 1 2.7M tokens on December 12th.
2025-12-13 0 No tokens on December 13th.
2025-12-14 0 No tokens on December 14th.
2025-12-15 1 4.0M tokens on December 15th.
2025-12-16 2 12.9M tokens on December 16th.
2025-12-17 0 No tokens on December 17th.
2025-12-18 4 129.6M tokens on December 18th.
2025-12-19 0 No tokens on December 19th.
2025-12-20 0 No tokens on December 20th.
2025-12-21 0 No tokens on December 21st.
2025-12-22 0 No tokens on December 22nd.
2025-12-23 0 No tokens on December 23rd.
2025-12-24 0 No tokens on December 24th.
2025-12-25 0 No tokens on December 25th.
2025-12-26 0 No tokens on December 26th.
2025-12-27 0 No tokens on December 27th.
2025-12-28 0 No tokens on December 28th.
2025-12-29 0 No tokens on December 29th.
2025-12-30 0 No tokens on December 30th.
2025-12-31 0 No tokens on December 31st.
2026-01-01 0 No tokens on January 1st.
2026-01-02 0 No tokens on January 2nd.
2026-01-03 0 No tokens on January 3rd.
2026-01-04 3 34.1M tokens on January 4th.
2026-01-05 2 10.4M tokens on January 5th.
2026-01-06 1 1.6M tokens on January 6th.
2026-01-07 1 1.2M tokens on January 7th.
2026-01-08 3 22.2M tokens on January 8th.
2026-01-09 1 3.7M tokens on January 9th.
2026-01-10 0 No tokens on January 10th.
2026-01-11 3 22.1M tokens on January 11th.
2026-01-12 2 9.0M tokens on January 12th.
2026-01-13 2 7.0M tokens on January 13th.
2026-01-14 3 29.5M tokens on January 14th.
2026-01-15 0 No tokens on January 15th.
2026-01-16 3 17.3M tokens on January 16th.
2026-01-17 1 5.0M tokens on January 17th.
2026-01-18 0 No tokens on January 18th.
2026-01-19 2 12.8M tokens on January 19th.
2026-01-20 4 78.4M tokens on January 20th.
2026-01-21 2 10.1M tokens on January 21st.
2026-01-22 4 60.8M tokens on January 22nd.
2026-01-23 4 96.1M tokens on January 23rd.
2026-01-24 1 1.8M tokens on January 24th.
2026-01-25 1 571.3K tokens on January 25th.
2026-01-26 1 3.9M tokens on January 26th.
2026-01-27 2 7.1M tokens on January 27th.
2026-01-28 1 2.0M tokens on January 28th.
2026-01-29 2 14.7M tokens on January 29th.
2026-01-30 1 5.6M tokens on January 30th.
2026-01-31 1 3.0M tokens on January 31st.
2026-02-01 2 15.1M tokens on February 1st.
2026-02-02 4 274.5M tokens on February 2nd.
2026-02-03 4 94.2M tokens on February 3rd.
2026-02-04 2 15.7M tokens on February 4th.
2026-02-05 1 5.8M tokens on February 5th.
2026-02-06 4 39.5M tokens on February 6th.
2026-02-07 0 No tokens on February 7th.
2026-02-08 0 No tokens on February 8th.
2026-02-09 4 40.6M tokens on February 9th.
2026-02-10 4 77.4M tokens on February 10th.
2026-02-11 3 32.4M tokens on February 11th.
2026-02-12 3 36.3M tokens on February 12th.
2026-02-13 3 23.0M tokens on February 13th.
2026-02-14 0 No tokens on February 14th.
2026-02-15 0 No tokens on February 15th.
2026-02-16 2 6.6M tokens on February 16th.
2026-02-17 3 31.9M tokens on February 17th.
2026-02-18 0 No tokens on February 18th.
2026-02-19 2 9.1M tokens on February 19th.
2026-02-20 4 174.8M tokens on February 20th.
2026-02-21 4 42.0M tokens on February 21st.
2026-02-22 0 No tokens on February 22nd.
2026-02-23 3 19.0M tokens on February 23rd.
2026-02-24 4 50.4M tokens on February 24th.
2026-02-25 4 69.7M tokens on February 25th.
2026-02-26 1 2.5M tokens on February 26th.
2026-02-27 0 No tokens on February 27th.
2026-02-28 1 1.2M tokens on February 28th.
2026-03-01 0 No tokens on March 1st.
2026-03-02 4 39.4M tokens on March 2nd.
2026-03-03 4 61.4M tokens on March 3rd.
2026-03-04 0 No tokens on March 4th.
2026-03-05 4 66.6M tokens on March 5th.
2026-03-06 4 42.9M tokens on March 6th.
2026-03-07 0 No tokens on March 7th.
2026-03-08 2 7.8M tokens on March 8th.
2026-03-09 0 No tokens on March 9th.
2026-03-10 3 22.7M tokens on March 10th.
2026-03-11 4 69.1M tokens on March 11th.
2026-03-12 4 69.2M tokens on March 12th.
2026-03-13 3 24.7M tokens on March 13th.
2026-03-14 0 No tokens on March 14th.
2026-03-15 2 6.8M tokens on March 15th.
2026-03-16 3 23.8M tokens on March 16th.
2026-03-17 3 18.7M tokens on March 17th.
2026-03-18 1 2.7M tokens on March 18th.
2026-03-19 2 10.7M tokens on March 19th.
2026-03-20 2 6.6M tokens on March 20th.
2026-03-21 0 No tokens on March 21st.
2026-03-22 2 9.4M tokens on March 22nd.
2026-03-23 2 14.3M tokens on March 23rd.
2026-03-24 3 33.6M tokens on March 24th.
2026-03-25 1 5.6M tokens on March 25th.
2026-03-26 3 26.8M tokens on March 26th.
2026-03-27 1 1.3M tokens on March 27th.
2026-03-28 2 9.9M tokens on March 28th.
2026-03-29 0 No tokens on March 29th.
2026-03-30 3 18.4M tokens on March 30th.
2026-03-31 3 33.1M tokens on March 31st.
2026-04-01 3 23.7M tokens on April 1st.
2026-04-02 1 5.6M tokens on April 2nd.
2026-04-03 0 No tokens on April 3rd.
2026-04-04 0 No tokens on April 4th.
2026-04-05 0 No tokens on April 5th.
2026-04-06 0 No tokens on April 6th.
2026-04-07 0 No tokens on April 7th.
2026-04-08 0 No tokens on April 8th.
2026-04-09 0 No tokens on April 9th.
2026-04-10 0 No tokens on April 10th.
2026-04-11 0 No tokens on April 11th.
2026-04-12 0 No tokens on April 12th.
2026-04-13 2 6.7M tokens on April 13th.
2026-04-14 2 9.5M tokens on April 14th.
2026-04-15 2 6.6M tokens on April 15th.
2026-04-16 1 3.7M tokens on April 16th.
2026-04-17 4 92.5M tokens on April 17th.
2026-04-18 1 3.9M tokens on April 18th.
2026-04-19 3 17.7M tokens on April 19th.
2026-04-20 1 4.5M tokens on April 20th.
2026-04-21 2 11.2M tokens on April 21st.
2026-04-22 1 3.6M tokens on April 22nd.
2026-04-23 1 5.1M tokens on April 23rd.
2026-04-24 2 13.1M tokens on April 24th.
2026-04-25 0 No tokens on April 25th.
2026-04-26 4 115.6M tokens on April 26th.
2026-04-27 2 12.5M tokens on April 27th.
2026-04-28 1 2.4M tokens on April 28th.
2026-04-29 3 24.8M tokens on April 29th.
2026-04-30 3 22.9M tokens on April 30th.
2026-05-01 3 18.3M tokens on May 1st.
2026-05-02 0 No tokens on May 2nd.
2026-05-03 0 No tokens on May 3rd.
2026-05-04 3 38.5M tokens on May 4th.
2026-05-05 1 1.5M tokens on May 5th.
2026-05-06 3 27.2M tokens on May 6th.
2026-05-07 3 24.3M tokens on May 7th.
2026-05-08 4 90.2M tokens on May 8th.
2026-05-09 3 19.6M tokens on May 9th.
2026-05-10 2 12.3M tokens on May 10th.
2026-05-11 1 3.9M tokens on May 11th.
2026-05-12 1 3.7M tokens on May 12th.
2026-05-13 1 1.5M tokens on May 13th.
2026-05-14 0 No tokens on May 14th.
2026-05-15 4 56.5M tokens on May 15th.
2026-05-16 2 10.0M tokens on May 16th.
2026-05-17 0 No tokens on May 17th.
2026-05-18 3 22.4M tokens on May 18th.
2026-05-19 1 879.7K tokens on May 19th.
2026-05-20 4 154.4M tokens on May 20th.
2026-05-21 4 41.4M tokens on May 21st.
2026-05-22 3 16.9M tokens on May 22nd.
2026-05-23 0 No tokens on May 23rd.
2026-05-24 3 20.1M tokens on May 24th.
2026-05-25 4 47.6M tokens on May 25th.
2026-05-26 4 62.8M tokens on May 26th.
2026-05-27 1 5.2M tokens on May 27th.
2026-05-28 4 153.6M tokens on May 28th.
2026-05-29 4 62.3M tokens on May 29th.
2026-05-30 3 20.5M tokens on May 30th.
2026-05-31 1 586.4K tokens on May 31st.
2026-06-01 2 12.4M tokens on June 1st.
2026-06-02 3 23.9M tokens on June 2nd.
2026-06-03 1 2.2M tokens on June 3rd.
2026-06-04 2 6.8M tokens on June 4th.
2026-06-05 4 122.4M tokens on June 5th.
2026-06-06 0 No tokens on June 6th.
2026-06-07 4 66.7M tokens on June 7th.
2026-06-08 0 No tokens on June 8th.
2026-06-09 4 1.3B tokens on June 9th.
2026-06-10 4 96.4M tokens on June 10th.
2026-06-11 1 684.5K tokens on June 11th.
2026-06-12 1 412 tokens on June 12th.
2026-06-13 0 No tokens on June 13th.
2026-06-14 0 No tokens on June 14th.
2026-06-15 2 13.4M tokens on June 15th.
2026-06-16 3 36.0M tokens on June 16th.
2026-06-17 2 9.4M tokens on June 17th.
2026-06-18 3 34.8M tokens on June 18th.
2026-06-19 2 8.7M tokens on June 19th.
2026-06-20 0 No tokens on June 20th.
2026-06-21 0 No tokens on June 21st.
2026-06-22 3 17.1M tokens on June 22nd.
2026-06-23 4 93.9M tokens on June 23rd.
2026-06-24 3 19.8M tokens on June 24th.
2026-06-25 3 25.3M tokens on June 25th.
2026-06-26 3 17.9M tokens on June 26th.
2026-06-27 1 482.0K tokens on June 27th.
2026-06-28 3 18.6M tokens on June 28th.
2026-06-29 2 13.6M tokens on June 29th.
2026-06-30 4 89.5M tokens on June 30th.
2026-07-01 2 7.5M tokens on July 1st.
2026-07-02 2 14.7M tokens on July 2nd.
2026-07-03 4 87.0M tokens on July 3rd.
2026-07-04 0 No tokens on July 4th.
2026-07-05 2 8.6M tokens on July 5th.
2026-07-06 0 No tokens on July 6th.
2026-07-07 3 22.2M tokens on July 7th.
2026-07-08 2 7.1M tokens on July 8th.
2026-07-09 1 2.0M tokens on July 9th.
2026-07-10 3 19.1M tokens on July 10th.
2026-07-11 4 39.0M tokens on July 11th.
2026-07-12 0 No tokens on July 12th.
2026-07-13 4 127.8M tokens on July 13th.
2026-07-14 3 30.1M tokens on July 14th.
2026-07-15 4 51.0M tokens on July 15th.
2026-07-16 4 80.6M tokens on July 16th.
2026-07-17 2 14.8M tokens on July 17th.
2026-07-18 2 8.8M tokens on July 18th.
2026-07-19 0 No tokens on July 19th.
2026-07-20 3 21.6M tokens on July 20th.
2026-07-21 0 No tokens on July 21st.
2026-07-22 2 15.9M tokens on July 22nd.
2026-07-23 4 84.5M tokens on July 23rd.
2026-07-24 2 13.4M tokens on July 24th.
2026-07-25 3 25.2M tokens on July 25th.
2026-07-26 3 20.7M tokens on July 26th.
2026-07-27 2 14.0M tokens on July 27th.
2026-07-28 3 24.8M tokens on July 28th.
2026-07-29 4 49.2M tokens on July 29th.
2026-07-30 3 18.0M tokens on July 30th.
2026-07-31 4 154.5M tokens on July 31st.
2026-08-01 0 No tokens on August 1st.
2026-08-02 3 16.2M tokens on August 2nd.
2026-08-03 2 7.0M tokens on August 3rd.
2026-08-04 2 10.5M tokens on August 4th.
2026-08-05 2 11.6M tokens on August 5th.
2026-08-06 1 2.8M tokens on August 6th.
2026-08-07 4 105.1M tokens on August 7th.
2026-08-08 0 No tokens on August 8th.
2026-08-09 0 No tokens on August 9th.
2026-08-10 0 No tokens on August 10th.
2026-08-11 0 No tokens on August 11th.
2026-08-12 0 No tokens on August 12th.
2026-08-13 0 No tokens on August 13th.
2026-08-14 0 No tokens on August 14th.
2026-08-15 0 No tokens on August 15th.
2026-08-16 0 No tokens on August 16th.
2026-08-17 0 No tokens on August 17th.
2026-08-18 0 No tokens on August 18th.
2026-08-19 0 No tokens on August 19th.
2026-08-20 0 No tokens on August 20th.
2026-08-21 0 No tokens on August 21st.
2026-08-22 0 No tokens on August 22nd.
2026-08-23 0 No tokens on August 23rd.
2026-08-24 0 No tokens on August 24th.
2026-08-25 2 5.9M tokens on August 25th.
2026-08-26 3 32.6M tokens on August 26th.
2026-08-27 0 No tokens on August 27th.
2026-08-28 4 99.5M tokens on August 28th.
2026-08-29 2 10.1M tokens on August 29th.
2026-08-30 2 13.3M tokens on August 30th.
2026-08-31 4 39.6M tokens on August 31st.
2026-09-01 4 110.0M tokens on September 1st.
2026-09-02 1 3.0M tokens on September 2nd.
2026-09-03 4 93.5M tokens on September 3rd.
2026-09-04 3 29.0M tokens on September 4th.
2026-09-05 0 No tokens on September 5th.
2026-09-06 2 8.2M tokens on September 6th.
2026-09-07 1 3.1M tokens on September 7th.
2026-09-08 1 1.2M tokens on September 8th.
2026-09-09 2 10.7M tokens on September 9th.
2026-09-10 1 4.0M tokens on September 10th.
2026-09-11 4 69.8M tokens on September 11th.
2026-09-12 0 No tokens on September 12th.
2026-09-13 0 No tokens on September 13th.
2026-09-14 1 5.2M tokens on September 14th.
2026-09-15 4 44.9M tokens on September 15th.
2026-09-16 2 8.5M tokens on September 16th.
2026-09-17 3 31.0M tokens on September 17th.
2026-09-18 1 3.3M tokens on September 18th.
2026-09-19 4 77.5M tokens on September 19th.
2026-09-20 4 39.6M tokens on September 20th.
2026-09-21 4 52.8M tokens on September 21st.
2026-09-22 1 3.3M tokens on September 22nd.
2026-09-23 3 18.8M tokens on September 23rd.
2026-09-24 1 4.8M tokens on September 24th.
2026-09-25 3 38.2M tokens on September 25th.
2026-09-26 4 56.8M tokens on September 26th.
2026-09-27 3 19.7M tokens on September 27th.
2026-09-28 3 18.5M tokens on September 28th.
2026-09-29 3 22.0M tokens on September 29th.
2026-09-30 2 8.5M tokens on September 30th.
2026-10-01 4 97.8M tokens on October 1st.
2026-10-02 2 13.1M tokens on October 2nd.
2026-10-03 1 2.2M tokens on October 3rd.
2026-10-04 1 2.4M tokens on October 4th.
2026-10-05 2 8.3M tokens on October 5th.
2026-10-06 1 4.7M tokens on October 6th.
2026-10-07 2 13.0M tokens on October 7th.
2026-10-08 1 3.5M tokens on October 8th.
2026-10-09 3 19.8M tokens on October 9th.
2026-10-10 4 49.9M tokens on October 10th.
2026-10-11 0 No tokens on October 11th.
2026-10-12 0 No tokens on October 12th.
2026-10-13 1 2.8M tokens on October 13th.
2026-10-14 0 No tokens on October 14th.
2026-10-15 4 78.0M tokens on October 15th.
2026-10-16 1 2.0M tokens on October 16th.
2026-10-17 0 No tokens on October 17th.
2026-10-18 0 No tokens on October 18th.
2026-10-19 1 1.7M tokens on October 19th.
2026-10-20 4 110.9M tokens on October 20th.
2026-10-21 2 7.0M tokens on October 21st.
2026-10-22 1 4.1M tokens on October 22nd.
2026-10-23 4 335.1M tokens on October 23rd.
2026-10-24 1 3.7M tokens on October 24th.
2026-10-25 0 No tokens on October 25th.
2026-10-26 3 17.8M tokens on October 26th.
2026-10-27 2 13.1M tokens on October 27th.
2026-10-28 2 14.2M tokens on October 28th.
2026-10-29 2 7.8M tokens on October 29th.
2026-10-30 4 110.0M tokens on October 30th.
2026-10-31 0 No tokens on October 31st.
2026-11-01 0 No tokens on November 1st.
2026-11-02 1 3.0M tokens on November 2nd.
2026-11-03 3 19.1M tokens on November 3rd.
2026-11-04 3 28.2M tokens on November 4th.
2026-11-05 1 1.8M tokens on November 5th.
2026-11-06 2 12.4M tokens on November 6th.
2026-11-07 0 No tokens on November 7th.
2026-11-08 1 453.3K tokens on November 8th.
2026-11-09 4 88.2M tokens on November 9th.
2026-11-10 3 19.1M tokens on November 10th.
2026-11-11 4 69.1M tokens on November 11th.
2026-11-12 1 1.2M tokens on November 12th.
2026-11-13 4 72.7M tokens on November 13th.
`
}
