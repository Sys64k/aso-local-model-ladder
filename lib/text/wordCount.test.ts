import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty text", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only text", () => {
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t\r")).toBe(0);
    expect(countWords(" \n \t \r ")).toBe(0);
  });

  it("counts words with letters and digits", () => {
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("123 abc")).toBe(2);
    expect(countWords("Test123")).toBe(1);
  });

  it("handles hyphenated words correctly", () => {
    expect(countWords("well-known")).toBe(1);
    expect(countWords("state-of-the-art")).toBe(1);
    expect(countWords("a well-known example")).toBe(3);
  });

  it("handles apostrophes correctly", () => {
    expect(countWords("don't")).toBe(1);
    expect(countWords("it's a test")).toBe(3);
    expect(countWords("John's car")).toBe(2);
  });

  it("does not count punctuation alone as words", () => {
    expect(countWords("!@#$%")).toBe(0);
    expect(countWords(". , ; :")).toBe(0);
    expect(countWords("Hello! How are you?")).toBe(4);
  });

  it("handles mixed content correctly", () => {
    expect(countWords("Hello, world! It's a beautiful day.")).toBe(6);
    expect(countWords("Page 123 is about well-known things")).toBe(6);
    expect(countWords("What's up? Nothing much.")).toBe(4);
  });

  it("counts numbers as words", () => {
    expect(countWords("The answer is 42")).toBe(4);
    expect(countWords("123 456 789")).toBe(3);
  });
});