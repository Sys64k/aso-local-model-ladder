/**
 * Word counting utilities for text.
 */

const WORD_RE = /[\p{L}0-9]+(?:[-']?[\p{L}0-9]+)*/gu

/**
 * Count the number of words in the given text.
 *
 * Words are runs of letters or digits; hyphenated words (`well-known`) and
 * apostrophes (`don't`) count as one word.
 *
 * @param text - The text to count words in.
 * @returns The number of words.
 */
export function countWords(text: string): number {
  const matches = [];
  let match;
  while ((match = WORD_RE.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return matches.length;
}