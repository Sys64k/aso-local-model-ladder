// Word counting with proper handling of hyphens, apostrophes, and Unicode letters/digits

// Compile regex outside the function to avoid repeated compilation and potential issues
// We use the Unicode property escapes \p{L} for letters and \p{N} for numbers
// The pattern matches: one or more letter/number, followed by zero or more
// hyphen/apostrophe/curly-apostrophe with adjacent letters/numbers
const wordRegex = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  // If the text is empty or whitespace-only, return 0
  if (!text || text.trim().length === 0) {
    return 0;
  }

  // Use matchAll to get all matches
  const matches = text.matchAll(wordRegex);

  // Convert the iterator to an array and count the matches
  return [...matches].length;
}