import type { Theme } from "./settings";

/**
 * Colour tokens for each theme. These are mirrored as CSS custom properties in
 * `app/globals.css` (a unit test checks the two stay in sync and that every
 * text/background pair meets WCAG AAA, i.e. a contrast ratio of at least 7:1).
 */
export interface ThemeTokens {
  /** Page background */
  bg: string;
  /** Body text */
  fg: string;
  /** Secondary text (e.g. dimmed sentences in focus view) */
  muted: string;
  /** Raised surfaces (header, cards, dialogs) */
  surface: string;
  /** Accent: primary button background, also usable as text on bg/surface */
  accent: string;
  /** Text on accent backgrounds */
  accentFg: string;
  /** Current sentence */
  highlightBg: string;
  highlightFg: string;
  /** Current word */
  wordBg: string;
  wordFg: string;
  /** Keyboard focus indicator (non-text: needs 3:1 against bg) */
  focusRing: string;
}

export const THEME_TOKENS: Record<Theme, ThemeTokens> = {
  light: {
    bg: "#ffffff",
    fg: "#1a1a1a",
    muted: "#4a4a4a",
    surface: "#f2f2f2",
    accent: "#1e3a8a",
    accentFg: "#ffffff",
    highlightBg: "#ffe066",
    highlightFg: "#1a1a1a",
    wordBg: "#1e3a8a",
    wordFg: "#ffffff",
    focusRing: "#1e3a8a",
  },
  dark: {
    bg: "#121212",
    fg: "#f0f0f0",
    muted: "#bdbdbd",
    surface: "#1e1e1e",
    accent: "#9cc3ff",
    accentFg: "#121212",
    highlightBg: "#ffe066",
    highlightFg: "#121212",
    wordBg: "#9cc3ff",
    wordFg: "#121212",
    focusRing: "#9cc3ff",
  },
  "high-contrast": {
    bg: "#000000",
    fg: "#ffffff",
    muted: "#d0d0d0",
    surface: "#111111",
    accent: "#00ffff",
    accentFg: "#000000",
    highlightBg: "#ffffff",
    highlightFg: "#000000",
    wordBg: "#ffff00",
    wordFg: "#000000",
    focusRing: "#ffff00",
  },
  "yellow-black": {
    bg: "#000000",
    fg: "#ffff00",
    muted: "#cccc00",
    surface: "#111111",
    accent: "#ffff00",
    accentFg: "#000000",
    highlightBg: "#ffff00",
    highlightFg: "#000000",
    wordBg: "#ffffff",
    wordFg: "#000000",
    focusRing: "#ffffff",
  },
  sepia: {
    bg: "#f4ecd8",
    fg: "#3b2f1e",
    muted: "#4f4030",
    surface: "#ebe0c4",
    accent: "#5c3a00",
    accentFg: "#f4ecd8",
    highlightBg: "#ffd98a",
    highlightFg: "#3b2f1e",
    wordBg: "#5c3a00",
    wordFg: "#fff8e7",
    focusRing: "#5c3a00",
  },
};

/** Capitalised names for labels. */
export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  "high-contrast": "High contrast (white on black)",
  "yellow-black": "Yellow on black",
  sepia: "Sepia",
};

/** Lower-case names for announcements ("Theme: yellow on black"). */
export const THEME_NAMES: Record<Theme, string> = {
  light: "light",
  dark: "dark",
  "high-contrast": "high contrast",
  "yellow-black": "yellow on black",
  sepia: "sepia",
};

/** CSS custom property name for each token. */
export const TOKEN_CSS_VARS: Record<keyof ThemeTokens, string> = {
  bg: "--bg",
  fg: "--fg",
  muted: "--muted",
  surface: "--surface",
  accent: "--accent",
  accentFg: "--accent-fg",
  highlightBg: "--highlight-bg",
  highlightFg: "--highlight-fg",
  wordBg: "--word-bg",
  wordFg: "--word-fg",
  focusRing: "--focus-ring",
};

/** Text/background pairs that must reach 7:1 (WCAG AAA). */
export const TEXT_PAIRS: readonly [keyof ThemeTokens, keyof ThemeTokens][] = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["accentFg", "accent"],
  ["highlightFg", "highlightBg"],
  ["wordFg", "wordBg"],
];

function channel(hex2: string): number {
  const c = parseInt(hex2, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rgb or #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Invalid colour: ${hex}`);
  return (
    0.2126 * channel(h.slice(0, 2)) +
    0.7152 * channel(h.slice(2, 4)) +
    0.0722 * channel(h.slice(4, 6))
  );
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
