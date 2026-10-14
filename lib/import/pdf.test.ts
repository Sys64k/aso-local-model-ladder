import { describe, expect, it } from "vitest";
import { joinTextItems } from "./pdf";

const item = (str: string, y: number, opts: { h?: number; eol?: boolean } = {}) => ({
  str,
  transform: [opts.h ?? 12, 0, 0, opts.h ?? 12, 72, y],
  width: 10,
  height: opts.h ?? 12,
  dir: "ltr",
  fontName: "f",
  hasEOL: opts.eol ?? false,
});

describe("joinTextItems", () => {
  it("joins items on a line, breaks lines and inserts paragraph breaks at vertical gaps", () => {
    const text = joinTextItems([
      item("Hello", 700),
      item(" world", 700),
      item("second line", 686),
      { type: "beginMarkedContent" },
      item("New paragraph", 640),
    ]);
    expect(text).toBe("Hello world\nsecond line\n\nNew paragraph");
  });

  it("honours hasEOL on items and empty EOL markers", () => {
    expect(joinTextItems([item("a", 100, { eol: true }), item("b", 100)])).toBe("a\nb");
    expect(joinTextItems([item("a", 100), item("", 100, { eol: true }), item("b", 100)])).toBe(
      "a\nb",
    );
  });

  it("returns an empty string when there is no text", () => {
    expect(joinTextItems([])).toBe("");
    expect(joinTextItems([{ type: "endMarkedContent" }])).toBe("");
  });
});
