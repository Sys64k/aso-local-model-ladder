import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t\n")).toBe(0);
  });

  it("returns 0 for whitespace-only input", () => {
    expect(countWords(" ")).toBe(0);
    expect(countWords("\n")).toBe(0);
    expect(countWords("\t")).toBe(0);
    expect(countWords("\n\t\r")).toBe(0);
  });

  it("does not count punctuation alone as a word", () => {
    expect(countWords(".")).toBe(0);
    expect(countWords("!")).toBe(0);
    expect(countWords("?")).toBe(0);
    expect(countWords(",")).toBe(0);
    expect(countWords(";")).toBe(0);
    expect(countWords(":-)")).toBe(0);
    expect(countWords("Hello, world!")).toBe(2);
  });

  it("counts hyphenated words as a single word", () => {
    expect(countWords("well-known")).toBe(1);
    expect(countWords("high-level")).toBe(1);
    expect(countWords("state-of-the-art")).toBe(1);
  });

  it("counts words with apostrophes as single words", () => {
    expect(countWords("don't")).toBe(1);
    expect(countWords("can't")).toBe(1);
    expect(countWords("it's")).toBe(1);
    expect(countWords("I'm fine!")).toBe(2);
  });

  it("counts numbers as words", () => {
    expect(countWords("123")).toBe(1);
    expect(countWords("123abc")).toBe(1);
    expect(countWords("a1b2c3")).toBe(1);
  });

  it("counts combinations correctly", () => {
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("Hello, world!")).toBe(2);
    expect(countWords("Hello, world! How are you?")).toBe(5);
    expect(countWords("one two three")).toBe(3);
  });

  it("handles multiple spaces and newlines", () => {
    expect(countWords("one    two\n\nthree")).toBe(3);
    expect(countWords("  one  \t  two  \n  three  ")).toBe(3);
  });

  it("handles edge cases", () => {
    expect(countWords("...")).toBe(0);
    expect(countWords("!!!")).toBe(0);
    expect(countWords("a.b.c")).toBe(3);
    expect(countWords("a.b")).toBe(2);
  });

  it("counts words correctly in mixed text", () => {
    expect(countWords("Python is awesome. It's fun! 123 is a number.")).toBe(9);
    expect(countWords("This is a test.")).toBe(4);
  });
});