/**
 * Counts words in text. A word is a run of letters or digits.
 * Hyphenated words (well-known) and apostrophes (don't) count as one word.
 * 
 * @param text - The text to count words in
 * @returns The number of words in the text
 */
export function countWords(text: string): number {
  // Handle empty or whitespace-only text
  if (!text || !text.trim()) {
    return 0;
  }
  
  // Match sequences that contain letters, digits, hyphens, and apostrophes
  const matches = text.match(/[a-zA-Z0-9]+(?:[-'][a-zA-Z0-9]+)*/g);
  
  return matches ? matches.length : 0;
}