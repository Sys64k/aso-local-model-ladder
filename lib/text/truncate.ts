/**
 * Truncate a string to a maximum number of words.
 * If the string contains more than `max` words, it is cut after the ${max}th word
 * and an ellipsis (U+2026) is appended.
 * Whitespace between the kept words is preserved as it appears in the original
 * text.  If `max` is less than 1, a RangeError is thrown.
 *
 * Words are defined the same way as in {@link countWords} – a run of
 * letters or digits, optionally containing hyphens or apostrophes.
 *
 * @param text - The input string.
 * @param max - Maximum number of words to keep.
 * @returns The (possibly truncated) string.
 */
export function truncateWords(text: string, max: number): string {
  if (max < 1) {
    throw new RangeError("max must be at least 1");
  }

  if (!text) return text;

  const re = /[a-zA-Z0-9]+(?:[-'][a-zA-Z0-9]+)*/g;
  let match: RegExpExecArray | null;
  let count = 0;
  let lastWordEnd = 0;

  while ((match = re.exec(text)) !== null) {
    count++;
    if (count === max) {
      lastWordEnd = match.index + match[0].length;
      break;
    }
  }

  if (count < max) {
    return text;
  }

  // slice up to the end of the max-th word and add ellipsis
  return text.slice(0, lastWordEnd) + "…";
}
