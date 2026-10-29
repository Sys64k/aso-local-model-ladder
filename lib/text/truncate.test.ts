import { describe, expect, it } from "vitest";
import { truncateWords } from "./truncate";

describe("truncateWords", () => {
  it("keeps text within limit unchanged", () => {
    expect(truncateWords("Hello world", 3)).toBe("Hello world");
  });

  it("keeps exactly max words unchanged", () => {
    expect(truncateWords("one two three", 3)).toBe("one two three");
  });

  it("truncates after max words and adds ellipsis", () => {
    const text = "I love programming with JavaScript and TypeScript";
    const truncated = truncateWords(text, 5);
    expect(truncated).toBe("I love programming with JavaScript…");
  });

  it("preserves whitespace between kept words", () => {
    const text = "  foo   bar\n  baz  ";
    const truncated = truncateWords(text, 2);
    expect(truncated).toBe("  foo   bar…");
  });

  it("throws RangeError for max < 1", () => {
    expect(() => truncateWords("text", 0)).toThrow(RangeError);
    expect(() => truncateWords("text", -5)).toThrow(RangeError);
  });
});
