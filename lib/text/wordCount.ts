/**
 * Counts words in text, where words are runs of letters or digits.
 * Hyphenated words (well-known) and apostrophes (don't) count as one word.
 * 
 * @param text - The text to count words in
 * @returns The number of words in the text
 */
export function countWords(text: string): number {
  // Handle empty or whitespace-only text
  if (!text || text.trim() === '') {
    return 0;
  }

  // Use regex to match words that consist of letters, digits, and optionally 
  // apostrophes/hyphens within words (but not at the start/end)
  // The regex [\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)* matches:
  // - One or more Unicode letters or digits
  // - Optionally followed by an apostrophe, curly apostrophe, or hyphen 
  //   followed by one or more letters or digits
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  
  return words ? words.length : 0;
}