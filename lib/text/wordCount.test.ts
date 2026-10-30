import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" ")).toBe(0);
    expect(countWords("   \n\n \t \r\n ")).toBe(0);
    expect(countWords("\u00A0\u2003")).toBe(0);
  });

  it("does not count punctuation alone as a word", () => {
    expect(countWords(".")).toBe(0);
    expect(countWords("... !!! ??? , ; :")).toBe(0);
    expect(countWords("-")).toBe(0);
    expect(countWords(" - -- --- ")).toBe(0);
    expect(countWords("'")).toBe(0);
    expect(countWords("\" ' ( ) [ ] — – …")).toBe(0);
    expect(countWords("& @ # $ % * / \\")).toBe(0);
  });

  it("counts simple words separated by any whitespace", () => {
    expect(countWords("hello")).toBe(1);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("  one\ttwo\nthree   four\r\nfive  ")).toBe(5);
  });

  it("ignores punctuation attached to words", () => {
    expect(countWords("Hello, world!")).toBe(2);
    expect(countWords("Wait... what?!")).toBe(2);
    expect(countWords('She said "Stop." Then she left.')).toBe(6);
    expect(countWords("(parenthesised) [bracketed]")).toBe(2);
  });

  it("splits words joined only by punctuation other than hyphens and apostrophes", () => {
    expect(countWords("yes—no")).toBe(2);
    expect(countWords("one,two;three")).toBe(3);
    expect(countWords("end.Start")).toBe(2);
    expect(countWords("and/or")).toBe(2);
  });

  it("counts hyphenated words as one word", () => {
    expect(countWords("well-known")).toBe(1);
    expect(countWords("a well-known fact")).toBe(3);
    expect(countWords("state-of-the-art")).toBe(1);
    expect(countWords("COVID-19")).toBe(1);
  });

  it("counts words with apostrophes as one word", () => {
    expect(countWords("don't")).toBe(1);
    expect(countWords("I don't know")).toBe(3);
    expect(countWords("it's the cat's toy")).toBe(4);
    expect(countWords("don\u2019t")).toBe(1);
  });

  it("does not count a free-standing hyphen or apostrophe as a word", () => {
    expect(countWords("yes - no")).toBe(2);
    expect(countWords("rock ' roll")).toBe(2);
    expect(countWords("'quoted'")).toBe(1);
    expect(countWords("the students' books")).toBe(3);
  });

  it("counts numbers as words", () => {
    expect(countWords("42")).toBe(1);
    expect(countWords("0")).toBe(1);
    expect(countWords("3 apples and 12 pears")).toBe(5);
    expect(countWords("2nd place")).toBe(2);
  });

  it("counts words with non-ASCII letters", () => {
    expect(countWords("café naïve")).toBe(2);
    expect(countWords("Grüße aus Köln")).toBe(3);
    expect(countWords("привет мир")).toBe(2);
  });

  it("gives the same result on repeated calls", () => {
    const text = "One two three. Four-five don't 6!";
    expect(countWords(text)).toBe(6);
    expect(countWords(text)).toBe(6);
    expect(countWords("a b")).toBe(2);
  });

  it("counts a longer paragraph", () => {
    const text =
      "Mr. Smith's well-known essay, written in 1999, isn't long:\n\njust 3 pages — and a half.";
    // Mr, Smith's, well-known, essay, written, in, 1999, isn't, long,
    // just, 3, pages, and, a, half
    expect(countWords(text)).toBe(15);
  });
});
