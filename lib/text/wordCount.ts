export function countWords(text: string): number {
    if (!text) {
        return 0;
    }
    // Match runs of letters or digits, treating hyphens and apostrophes as part of a word
    const words = text.match(/\b[\w'-]+\b/g);
    return words ? words.length : 0;
}