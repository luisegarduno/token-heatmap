// The profile README holds the block between two marker lines. The user's own text stays as it
// is around them, and the user moves the block by moving the markers.

export const START = "<!-- token-heatmap:start -->"
export const END = "<!-- token-heatmap:end -->"

/** README.md lacks the start marker, or an end marker after it. */
export class MarkersError extends Error {
  constructor() {
    super(`README.md has no "${START}" line followed by an "${END}" line, so the block has nowhere to go`)
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
