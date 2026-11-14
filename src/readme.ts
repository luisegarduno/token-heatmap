// The profile README holds the block between two marker lines. The user's own text stays as it
// is around them, and the user moves the block by moving the markers. setup adds the markers at
// the end of a README that has neither.

export const START = "<!-- token-heatmap:start -->"
export const END = "<!-- token-heatmap:end -->"

/** README.md lacks the start marker, or an end marker after it. */
export class MarkersError extends Error {
  constructor(
    message = `README.md has no "${START}" line followed by an "${END}" line, so the block has nowhere to go`,
  ) {
    super(message)
    this.name = "MarkersError"
  }
}

/**
 * The README with the text between the first start marker and the end marker after it replaced
 * by `block`, on lines of its own. Everything else stays byte for byte. Throws a MarkersError when
 * the markers are missing.
 */
export function replaceBlock(readme: string, block: string): string {
  const start = readme.indexOf(START)
  const end = start < 0 ? -1 : readme.indexOf(END, start + START.length)
  if (end < 0) throw new MarkersError()
  return `${readme.slice(0, start + START.length)}\n${block}\n${readme.slice(end)}`
}

/**
 * The README with the two markers added at its end, on lines of their own after a blank line,
 * when it has neither. "" gives the markers alone. A README that replaceBlock can use is
 * returned as it is. One that holds a single marker, or the end before the start, throws a
 * MarkersError: a pair added below it would put the user's own text inside the block.
 */
export function withMarkers(readme: string): string {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start < 0 && end < 0) {
    const gap = readme === "" || readme.endsWith("\n\n") ? "" : readme.endsWith("\n") ? "\n" : "\n\n"
    return `${readme}${gap}${START}\n${END}\n`
  }
  if (start >= 0 && readme.indexOf(END, start + START.length) >= 0) return readme
  throw new MarkersError(
    start >= 0
      ? `README.md has a "${START}" line with no "${END}" line after it. Add the end marker where the block ` +
          "is to end, or delete the start marker, then run setup again"
      : `README.md has a "${END}" line with no "${START}" line before it. Add the start marker where the ` +
          "block is to begin, or delete the end marker, then run setup again",
  )
}
