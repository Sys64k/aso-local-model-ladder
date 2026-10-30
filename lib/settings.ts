import { getDefaultStorage } from "./storage";

export type Theme = "light" | "dark" | "high-contrast" | "yellow-black" | "sepia";
export type FontChoice = "atkinson" | "lexend" | "sans" | "serif" | "mono";
export type HighlightMode = "sentence" | "word" | "both" | "none";
export type ViewMode = "full" | "focus";

export interface ReaderSettings {
  theme: Theme;
  /** px, 16–96 */
  fontSize: number;
  /** 1.2–3 */
  lineHeight: number;
  /** em, 0–0.3 */
  letterSpacing: number;
  /** em, 0–1 */
  wordSpacing: number;
  fontFamily: FontChoice;
  /** 0.5–2 */
  rate: number;
  /** 0–2 */
  pitch: number;
  /** 0–1 */
  volume: number;
  /** null = browser default voice */
  voiceURI: string | null;
  highlightMode: HighlightMode;
  viewMode: ViewMode;
  autoScroll: boolean;
}

export const THEMES: readonly Theme[] = [
  "light",
  "dark",
  "high-contrast",
  "yellow-black",
  "sepia",
];
export const FONT_CHOICES: readonly FontChoice[] = [
  "atkinson",
  "lexend",
  "sans",
  "serif",
  "mono",
];
export const HIGHLIGHT_MODES: readonly HighlightMode[] = [
  "sentence",
  "word",
  "both",
  "none",
];
export const VIEW_MODES: readonly ViewMode[] = ["full", "focus"];

export const DEFAULT_SETTINGS: ReaderSettings = Object.freeze({
  theme: "light",
  fontSize: 28,
  lineHeight: 1.8,
  letterSpacing: 0.02,
  wordSpacing: 0.1,
  fontFamily: "atkinson",
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: null,
  highlightMode: "both",
  viewMode: "full",
  autoScroll: true,
}) as ReaderSettings;

/** Numeric limits, exported so UI sliders can use the same bounds. */
export const SETTING_LIMITS = {
  fontSize: { min: 16, max: 96 },
  lineHeight: { min: 1.2, max: 3 },
  letterSpacing: { min: 0, max: 0.3 },
  wordSpacing: { min: 0, max: 1 },
  rate: { min: 0.5, max: 2 },
  pitch: { min: 0, max: 2 },
  volume: { min: 0, max: 1 },
} as const;

export const SETTINGS_STORAGE_KEY = "readaloud:settings:v1";

type NumericKey = keyof typeof SETTING_LIMITS;

function num(value: unknown, key: NumericKey): number {
  const { min, max } = SETTING_LIMITS[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, value));
  }
  return DEFAULT_SETTINGS[key];
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Fill in defaults, clamp numbers and replace invalid enum values. */
export function sanitizeSettings(input: unknown): ReaderSettings {
  const o: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const d = DEFAULT_SETTINGS;
  return {
    theme: o.theme !== undefined ? oneOf(o.theme, THEMES, d.theme) : d.theme,
    fontSize: o.fontSize !== undefined ? num(o.fontSize, "fontSize") : d.fontSize,
    lineHeight: o.lineHeight !== undefined ? num(o.lineHeight, "lineHeight") : d.lineHeight,
    letterSpacing: o.letterSpacing !== undefined ? num(o.letterSpacing, "letterSpacing") : d.letterSpacing,
    wordSpacing: o.wordSpacing !== undefined ? num(o.wordSpacing, "wordSpacing") : d.wordSpacing,
    fontFamily: o.fontFamily !== undefined ? oneOf(o.fontFamily, FONT_CHOICES, d.fontFamily) : d.fontFamily,
    rate: o.rate !== undefined ? num(o.rate, "rate") : d.rate,
    pitch: o.pitch !== undefined ? num(o.pitch, "pitch") : d.pitch,
    volume: o.volume !== undefined ? num(o.volume, "volume") : d.volume,
    voiceURI:
      typeof o.voiceURI === "string" && o.voiceURI.length > 0 ? o.voiceURI : null,
    highlightMode: o.highlightMode !== undefined ? oneOf(o.highlightMode, HIGHLIGHT_MODES, d.highlightMode) : d.highlightMode,
    viewMode: o.viewMode !== undefined ? oneOf(o.viewMode, VIEW_MODES, d.viewMode) : d.viewMode,
    autoScroll: typeof o.autoScroll === "boolean" ? o.autoScroll : d.autoScroll,
  };
}

/** Load settings; falls back to defaults on missing storage, missing key or corrupt JSON. */
export function loadSettings(storage?: Storage | null): ReaderSettings {
  const store = storage ?? getDefaultStorage();
  if (!store) return DEFAULT_SETTINGS;
  try {
    const raw = store.getItem(SETTINGS_STORAGE_KEY);
    if (raw == null) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Save settings. Never throws (quota exceeded / private mode are ignored). */
export function saveSettings(s: ReaderSettings, storage?: Storage | null): void {
  if (!storage) return;
  try {
    const sanitized = sanitizeSettings(s);
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore
  }
}
