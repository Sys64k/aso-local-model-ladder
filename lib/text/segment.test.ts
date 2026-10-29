import { describe, it, expect } from "vitest";
import { normalizeText } from "./segment";

declare const ZERO_WIDTH: {
  ZWSP: string;
  ZWNJ: string;
  ZWJ: string;
  BOM: string;
};

const ZWSP = "\u200B";
const ZWNJ = "\u200C";
const ZWJ = "\u200D";
const BOM = "\uFEFF";

describe("normalizeText", () => {
  it("removes zero‑width characters", () => {
    const raw = "Hello" + ZWSP + " World" + ZWNJ + "!" + " " + ZWJ + "Foo" + BOM + " Bar";
    const expected = "Hello World! Foo Bar";
    expect(normalizeText(raw)).toBe(expected);
  });

  it("does not alter text without zero‑width characters", () => {
    const raw = "Hello World! Foo Bar";
    expect(normalizeText(raw)).toBe(raw);
  });
});