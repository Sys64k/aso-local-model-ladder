import { describe, expect, it } from "vitest";
import {
  normalizeText,
  splitParagraphs,
  splitSentences,
  type Sentence,
} from "./segment";

function expectOffsetsMap(text: string, sentences: Sentence[]) {
  sentences.forEach((s, i) => {
    expect(s.index).toBe(i);
    expect(text.slice(s.start, s.end).trim()).toBe(s.text);
    expect(s.text.trim()).toBe(s.text);
    expect(s.text.length).toBeGreaterThan(0);
    if (i > 0) expect(s.start).toBeGreaterThanOrEqual(sentences[i - 1].end);
  });
}

describe("normalizeText", () => {
  it("converts CRLF and joins single line breaks into spaces", () => {
    expect(normalizeText("one line\r\nsecond line\rthird")).toBe(
      "one line second line third",
    );
  });

  it("joins words hyphenated across a line break", () => {
    expect(normalizeText("This is an exam-\nple of text.")).toBe(
      "This is an example of text.",
    );
    expect(normalizeText("exam-  \r\n  ple")).toBe("example");
  });

  it("keeps a hyphen before an uppercase continuation", () => {
    expect(normalizeText("the Anglo-\nSaxon era")).toBe("the Anglo-Saxon era");
  });

  it("keeps paragraph breaks as exactly two newlines", () => {
    expect(normalizeText("First para\nstill first.\n\n\n\nSecond para.")).toBe(
      "First para still first.\n\nSecond para.",
    );
    expect(normalizeText("A.\n  \n \t\nB.")).toBe("A.\n\nB.");
  });

  it("collapses spaces, trims and removes control characters", () => {
    expect(normalizeText("  Hello \u0000 \u0007world\t\tagain  ")).toBe(
      "Hello world again",
    );
    expect(normalizeText("\uFEFFBOM text\u001F")).toBe("BOM text");
  });

  it("handles empty input", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText(" \n\n \r\n ")).toBe("");
  });
});

describe.each([
  ["Intl.Segmenter", { segmenter: true }],
  ["regex fallback", { segmenter: false }],
])("splitSentences (%s)", (_name, opts) => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(splitSentences("", opts)).toEqual([]);
    expect(splitSentences("   \n\n  \t ", opts)).toEqual([]);
  });

  it("splits simple sentences with correct offsets", () => {
    const text = "Hello world. How are you? I am fine!";
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual([
      "Hello world.",
      "How are you?",
      "I am fine!",
    ]);
    expect(s[0]).toEqual({ index: 0, text: "Hello world.", start: 0, end: 12 });
    expectOffsetsMap(text, s);
  });

  it("does not split after common abbreviations", () => {
    const text =
      "Mr. Smith met Dr. Jones on Main St. yesterday. They discussed fruit, e.g. Apples, i.e. Red ones, etc. Then it was Mrs. Brown vs. Mr. Green.";
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual([
      "Mr. Smith met Dr. Jones on Main St. yesterday.",
      "They discussed fruit, e.g. Apples, i.e. Red ones, etc. Then it was Mrs. Brown vs. Mr. Green.",
    ]);
    expectOffsetsMap(text, s);
  });

  it("does not split decimal numbers", () => {
    const text = "Pi is about 3.14 today. It costs $2.50 now.";
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual([
      "Pi is about 3.14 today.",
      "It costs $2.50 now.",
    ]);
    expectOffsetsMap(text, s);
  });

  it("always ends a sentence at a paragraph break", () => {
    const text = "A heading without a period\n\nThe body starts here. More text";
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual([
      "A heading without a period",
      "The body starts here.",
      "More text",
    ]);
    expectOffsetsMap(text, s);
  });

  it("keeps offsets correct with messy whitespace", () => {
    const text = "   First one.    Second one?\n \n\n   Third one!   \n\n  ";
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual(["First one.", "Second one?", "Third one!"]);
    expectOffsetsMap(text, s);
  });

  it("handles closing quotes after the terminator", () => {
    const text = 'She said "Stop." Then she left.';
    const s = splitSentences(text, opts);
    expect(s.map((x) => x.text)).toEqual(['She said "Stop."', "Then she left."]);
    expectOffsetsMap(text, s);
  });
});

describe("splitParagraphs", () => {
  it("groups sentences by paragraph with global sentence indexes", () => {
    const text = "One. Two.\n\nThree. Four.\n\n\nFive.";
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(paragraphs.map((p) => p.sentences.map((s) => s.index))).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
    expect(paragraphs.map((p) => text.slice(p.start, p.end))).toEqual([
      "One. Two.",
      "Three. Four.",
      "Five.",
    ]);
    const all = paragraphs.flatMap((p) => p.sentences);
    expect(all).toEqual(splitSentences(text));
    expectOffsetsMap(text, all);
  });

  it("returns no paragraphs for empty input", () => {
    expect(splitParagraphs("")).toEqual([]);
    expect(splitParagraphs("\n\n\n")).toEqual([]);
  });
});
