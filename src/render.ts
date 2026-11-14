// history → the README block. No I/O and no clock: the same history and `today` give the same
// bytes everywhere.
//
// The block is the one Phase 1 put on a real profile (test/fixtures/block.html), and each rule
// below was measured there:
//
// - Every image sits in its own link with tabindex="-1". GitHub wraps a bare README image in a
//   link of its own, and Tab would stop on it. Only a day cell has a title, which a desktop
//   browser shows as the tooltip.
// - The images of a row touch in the source. A line break goes inside a tag, as in "<br\n>";
//   between two tags it would show as a gap.
// - GitHub adds `height: auto` to a README image that has a height, so each image's width and
//   height are those of its file in plugin/assets/.
// - Only tags and attributes GitHub keeps: table, tr, td nowrap, b, br, kbd, a href title
//   tabindex, img src width height hspace align alt.
//
// Nothing from the history but numbers reaches the block, so nothing in it needs escaping.

import { levels } from "./levels.ts"
import type { HistoryLine, Tokens } from "./providers/provider.ts"
import { isDate } from "./store.ts"

/** Where every cell links: the history file beside the images in the profile repository. */
const HISTORY = "token-heatmap/history.jsonl"

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
const MONTH_FILES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const WEEKDAY_FILES = ["gap-30x14", "mon", "gap-30x14", "wed", "gap-30x14", "fri", "gap-30x14"] // Sunday is row 0

/** Each image file in plugin/assets/ and its own width and height. */
const IMAGES = new Map<string, readonly [number, number]>([
  ...[0, 1, 2, 3, 4].map((level) => [String(level), [14, 14]] as const), // a day of that level, and the legend
  ...MONTH_FILES.map((file) => [file, [28, 16]] as const), // a month label, two columns wide
  ["mon", [30, 14]],
  ["wed", [30, 14]],
  ["fri", [30, 14]],
  ["gap-30x14", [30, 14]], // the blank label of the other four weekday rows
  ["gap-30x16", [30, 16]], // the blank corner that starts the month row
  ["gap-14x16", [14, 16]], // the rest of a month's columns after its label
  ["gap-28x16", [28, 16]],
  ["gap-42x16", [42, 16]],
  ["gap-158x14", [158, 14]], // four of them indent the legend
  ["gap-2x2", [2, 2]], // with side margins, it holds the frame open on a narrow screen
  ["less", [36, 14]],
  ["more", [34, 14]],
])

/** The grid is 772 px wide: 30 for the weekday labels and 53 columns of 14. */
const GRID_WIDTH = 772

// Dates are whole days since 1970-01-01, so no clock and no time zone is involved.
const MS_PER_DAY = 86_400_000
const dayOf = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / MS_PER_DAY
const dateOf = (day: number) => new Date(day * MS_PER_DAY)

const sumOf = (t: Tokens) => t.input + t.output + t.cache_write + t.cache_read

/**
 * The block for the window that ends on `today` (YYYY-MM-DD): from the Sunday 52 weeks before
 * today's week, through today, so 365 to 371 days. A day's total is the four counts of every
 * line for that date, from every provider and machine. Lines outside the window count nowhere.
 * The text has no trailing newline and no markers.
 */
export function render(history: readonly HistoryLine[], today: string): string {
  if (!isDate(today)) throw new Error(`today is not a day written YYYY-MM-DD: ${JSON.stringify(today)}`)
  const last = dayOf(today)
  const first = last - dateOf(last).getUTCDay() - 364

  const totals = new Array<number>(last - first + 1).fill(0)
  for (const line of history) {
    const i = dayOf(line.date) - first
    if (i >= 0 && i < totals.length) totals[i] += sumOf(line.tokens)
  }
  const level = levels(totals)
  const total = totals.reduce((a, b) => a + b, 0)

  const cells = totals.map((tokens, i) => image(String(level[i]), tooltip(tokens, first + i)))
  const weekdayRow = (label: string, r: number) => image(label) + cells.filter((_, i) => i % 7 === r).join("")
  const rows = [monthRow(first, Math.ceil(totals.length / 7)), ...WEEKDAY_FILES.map(weekdayRow), holdRow(), legendRow()]

  return (
    `<table><tr><td nowrap>\n<b>${short(total, 2)}</b> Claude Code ${total === 1 ? "token" : "tokens"} in the last year<br>\n` +
    `<kbd>${rows.join("<br\n>")}</kbd>\n</td></tr></table>`
  )
}

function image(file: string, title?: string, hspace?: number): string {
  const size = IMAGES.get(file)
  if (!size) throw new Error(`the block has no image ${file}.svg`)
  const [width, height] = size
  return (
    `<a href="${HISTORY}"${title ? ` title="${title}"` : ""} tabindex="-1">` +
    `<img src="token-heatmap/${file}.svg" width="${width}" height="${height}"${hspace ? ` hspace="${hspace}"` : ""} align="top" alt=""></a>`
  )
}

/**
 * A blank corner, then one label for each run of columns whose Sunday falls in the same month.
 * A label is two columns wide, and one blank covers the rest of its run. A run of one column is
 * too narrow for a label and stays blank.
 */
function monthRow(first: number, columns: number): string {
  const month = (column: number) => dateOf(first + 7 * column).getUTCMonth()
  let row = image("gap-30x16")
  for (let c = 0; c < columns; ) {
    let run = 1
    while (c + run < columns && month(c + run) === month(c)) run++
    if (run === 1) row += image("gap-14x16")
    else row += image(MONTH_FILES[month(c)]) + (run > 2 ? image(`gap-${14 * (run - 2)}x16`) : "")
    c += run
  }
  return row
}

/**
 * GitHub gives every README image `max-width: 100%`, so images cannot hold the <kbd> frame open:
 * on a narrow screen the frame shrank to the screen while the grid ran on. Side margins are fixed
 * lengths and do hold it. One blank image with 385 px on each side: 2 + 2 × 385 = 772.
 */
const holdRow = () => image("gap-2x2", undefined, (GRID_WIDTH - 2) / 2)

/** Four blanks, then "Less", the five levels and "More": 4 × 158 + 36 + 5 × 14 + 34 = 772. */
const legendRow = () =>
  image("gap-158x14").repeat(4) +
  image("less") +
  [0, 1, 2, 3, 4].map((level) => image(String(level))).join("") +
  image("more")

/** "96.4M tokens on June 10th.", "1 token on June 12th.", "No tokens on June 14th." */
function tooltip(tokens: number, day: number): string {
  const date = dateOf(day)
  const when = `${MONTHS[date.getUTCMonth()]} ${ordinal(date.getUTCDate())}`
  if (tokens <= 0) return `No tokens on ${when}.`
  return `${short(tokens, 1)} ${tokens === 1 ? "token" : "tokens"} on ${when}.`
}

const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}

const UNITS = [
  [1_000n, "K"],
  [1_000_000n, "M"],
  [1_000_000_000n, "B"],
] as const

/**
 * A count with K, M or B and `decimals` places: "96.4M" with one, "96.41M" with two. Under 1,000
 * the count is written out. Halves round up, and a count that rounds to 1000.0K reads 1.0M.
 * BigInt keeps it exact for any whole number.
 */
function short(n: number, decimals: 1 | 2): string {
  if (n < 1000) return String(n)
  const scale = decimals === 1 ? 10n : 100n
  const rounded = (unit: bigint) => (BigInt(n) * scale + unit / 2n) / unit
  let u = n < 1e6 ? 0 : n < 1e9 ? 1 : 2
  if (u < 2 && rounded(UNITS[u][0]) >= 1000n * scale) u++
  const [unit, letter] = UNITS[u]
  const q = rounded(unit)
  return `${q / scale}.${String(q % scale).padStart(decimals, "0")}${letter}`
}
