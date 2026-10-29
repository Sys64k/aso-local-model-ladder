export function truncateWords(text: string, max: number): string {
  if (max < 1) {
    throw new RangeError("max must be at least 1");
  }
  // Find words and their positions
  const wordRegex = /\S+/g;
  let match: RegExpExecArray | null;
  let count = 0;
  let lastEnd = 0;
  while ((match = wordRegex.exec(text)) !== null) {
    count++;
    if (count === max) {
      lastEnd = match.index + match[0].length;
      break;
    }
  }
  // If fewer words than max, or none, return unchanged
  if (count < max) {
    return text;
  }
  // If exactly max words but no more words, return unchanged
  if (count === max) {
    // Check whether there's another word after the max-th word
    const next = wordRegex.exec(text);
    if (!next) {
      return text;
    }
    return text.slice(0, lastEnd) + '…';
  }
  // Should not reach here
  return text;

}
