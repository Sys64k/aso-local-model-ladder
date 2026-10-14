import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "./settings";
import {
  THEME_TOKENS,
  TEXT_PAIRS,
  TOKEN_CSS_VARS,
  contrastRatio,
  relativeLuminance,
  type ThemeTokens,
} from "./themes";

describe("contrast helpers", () => {
  it("computes the WCAG contrast ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
    // Order does not matter.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#777777"));
    // Known value: #777 on white is about 4.48.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(relativeLuminance("#ffff00")).toBeCloseTo(0.9278, 3);
  });

  it("rejects invalid colours", () => {
    expect(() => relativeLuminance("red")).toThrow();
  });
});

describe("theme tokens", () => {
  it("defines tokens for all five themes", () => {
    expect(Object.keys(THEME_TOKENS).sort()).toEqual([...THEMES].sort());
  });

  it("uses white on black for high contrast and #FFFF00 on #000 for yellow-black", () => {
    expect(THEME_TOKENS["high-contrast"]).toMatchObject({ fg: "#ffffff", bg: "#000000" });
    expect(THEME_TOKENS["yellow-black"]).toMatchObject({ fg: "#ffff00", bg: "#000000" });
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const t = THEME_TOKENS[theme];
      for (const [fg, bg] of TEXT_PAIRS) {
        it(`${fg} on ${bg} meets 7:1`, () => {
          expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(7);
        });
      }
      it("focus ring is visible against the background (3:1)", () => {
        expect(contrastRatio(t.focusRing, t.bg)).toBeGreaterThanOrEqual(3);
      });
      it("current word is distinguishable from the sentence highlight", () => {
        expect(t.wordBg).not.toBe(t.highlightBg);
      });
    });
  }
});

describe("app/globals.css", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  function themeBlock(theme: string): Record<string, string> {
    const re = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`);
    const m = re.exec(css);
    if (!m) throw new Error(`No CSS block for theme ${theme}`);
    const vars: Record<string, string> = {};
    for (const v of m[1].matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
      vars[v[1]] = v[2].trim().toLowerCase();
    }
    return vars;
  }

  for (const theme of THEMES) {
    it(`defines the ${theme} theme with the same colours as lib/themes.ts`, () => {
      const vars = themeBlock(theme);
      for (const key of Object.keys(TOKEN_CSS_VARS) as (keyof ThemeTokens)[]) {
        expect(vars[TOKEN_CSS_VARS[key]], `${theme} ${TOKEN_CSS_VARS[key]}`).toBe(
          THEME_TOKENS[theme][key].toLowerCase(),
        );
      }
    });
  }
});
