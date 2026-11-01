import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty text", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only text", () => {
    expect(countWords(" ")).toBe(0);
    expect(countWords("   \t\n\r\n  ")).toBe(0);
  });

  it("counts simple space-separated words", () => {
    expect(countWords("hello")).toBe(1);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("The quick brown fox jumps")).toBe(5);
  });

  it("ignores leading, trailing and repeated whitespace of any kind", () => {
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("one\ntwo\tthree\r\nfour\n\nfive")).toBe(5);
  });

  it("does not count punctuation alone as a word", () => {
    expect(countWords(".")).toBe(0);
    expect(countWords("... !!! ??? , ; : -- — ' \" ( ) [ ]")).toBe(0);
    expect(countWords("-")).toBe(0);
    expect(countWords("'")).toBe(0);
  });

  it("does not count punctuation attached to words as extra words", () => {
    expect(countWords("Hello, world!")).toBe(2);
    expect(countWords("Wait... what?!")).toBe(2);
    expect(countWords('"Quoted" (parenthesised) [bracketed]')).toBe(3);
    expect(countWords("Hello , world .")).toBe(2);
  });

  it("splits words joined only by punctuation other than hyphens and apostrophes", () => {
    expect(countWords("one,two")).toBe(2);
    expect(countWords("end.Start")).toBe(2);
    expect(countWords("word—word")).toBe(2);
  });

  it("counts a hyphenated word as one word", () => {
    expect(countWords("well-known")).toBe(1);
    expect(countWords("a well-known fact")).toBe(3);
    expect(countWords("mother-in-law")).toBe(1);
  });

  it("does not count a free-standing or dangling hyphen as a word", () => {
    expect(countWords("this - that")).toBe(2);
    expect(countWords("-start end-")).toBe(2);
  });

  it("counts a word with an apostrophe as one word", () => {
    expect(countWords("don't")).toBe(1);
    expect(countWords("I don't know")).toBe(3);
    expect(countWords("it's the cat's toy")).toBe(4);
  });

  it("treats a typographic apostrophe like a straight one", () => {
    expect(countWords("don’t")).toBe(1);
    expect(countWords("I don’t know")).toBe(3);
  });

  it("does not count quotes around words as words", () => {
    expect(countWords("'hello'")).toBe(1);
    expect(countWords("‘single’ “double”")).toBe(2);
  });

  it("counts numbers as words", () => {
    expect(countWords("42")).toBe(1);
    expect(countWords("I have 3 cats and 12 dogs")).toBe(7);
    expect(countWords("2024")).toBe(1);
  });

  it("counts mixed letters and digits as one word", () => {
    expect(countWords("abc123")).toBe(1);
    expect(countWords("mp3 files")).toBe(2);
  });

  it("counts words with non-ASCII letters", () => {
    expect(countWords("café")).toBe(1);
    expect(countWords("naïve résumé über")).toBe(3);
    expect(countWords("Привет мир")).toBe(2);
  });

  it("combines all rules in a realistic sentence", () => {
    expect(
      countWords("It's a well-known fact: 7 out of 10 people don't read — really!"),
    ).toBe(12);
  });
});
