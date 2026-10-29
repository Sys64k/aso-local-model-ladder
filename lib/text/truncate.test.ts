import { expect, test } from "vitest";
import { truncateWords } from "./truncate";

const sample = "The quick brown fox jumps over the lazy dog";

test("returns unchanged when text has fewer words than max", () => {
  expect(truncateWords("Hello world", 5)).toBe("Hello world");
});

test("returns unchanged when text has exactly max words", () => {
  expect(truncateWords("Hello world", 2)).toBe("Hello world");
});

test("truncates to max words and appends ellipsis", () => {
  const result = truncateWords(sample, 5);
  expect(result).toBe("The quick brown fox jumps…");
});

test("preserves original whitespace between kept words", () => {
  const text = "a   b\nc    d e";
  // Words: a, b, c, d, e -> 5 words
  const result = truncateWords(text, 3);
  // Should keep "a   b\nc" and ellipsis
  expect(result).toBe("a   b\nc…");
});

test("throws RangeError for nonpositive max", () => {
  expect(() => truncateWords("hello", 0)).toThrow(RangeError);
  expect(() => truncateWords("hello", -5)).toThrow(RangeError);
});
