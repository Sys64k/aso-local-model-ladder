import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  sanitizeSettings,
  saveSettings,
} from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
    });
    expect(SETTINGS_STORAGE_KEY).toBe("readaloud:settings:v1");
  });
});

describe("sanitizeSettings", () => {
  it("returns defaults for non-object input", () => {
    for (const input of [undefined, null, 42, "x", [], true]) {
      expect(sanitizeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("fills missing fields with defaults and keeps valid values", () => {
    const s = sanitizeSettings({ theme: "dark", fontSize: 40, voiceURI: "v1" });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", fontSize: 40, voiceURI: "v1" });
  });

  it("clamps out-of-range numbers", () => {
    const low = sanitizeSettings({
      fontSize: 2,
      lineHeight: 0,
      letterSpacing: -1,
      wordSpacing: -5,
      rate: 0.1,
      pitch: -1,
      volume: -0.5,
    });
    expect(low).toMatchObject({
      fontSize: 16,
      lineHeight: 1.2,
      letterSpacing: 0,
      wordSpacing: 0,
      rate: 0.5,
      pitch: 0,
      volume: 0,
    });
    const high = sanitizeSettings({
      fontSize: 500,
      lineHeight: 9,
      letterSpacing: 1,
      wordSpacing: 3,
      rate: 10,
      pitch: 5,
      volume: 2,
    });
    expect(high).toMatchObject({
      fontSize: 96,
      lineHeight: 3,
      letterSpacing: 0.3,
      wordSpacing: 1,
      rate: 2,
      pitch: 2,
      volume: 1,
    });
  });

  it("replaces non-numeric numbers, invalid enums and bad types with defaults", () => {
    const s = sanitizeSettings({
      theme: "neon",
      fontFamily: "comic-sans",
      highlightMode: "rainbow",
      viewMode: 3,
      fontSize: "40",
      rate: NaN,
      pitch: Infinity,
      voiceURI: 12,
      autoScroll: "yes",
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ voiceURI: "" }).voiceURI).toBeNull();
  });

  it("accepts every valid enum value", () => {
    expect(
      sanitizeSettings({
        theme: "yellow-black",
        fontFamily: "mono",
        highlightMode: "none",
        viewMode: "focus",
        autoScroll: false,
      }),
    ).toMatchObject({
      theme: "yellow-black",
      fontFamily: "mono",
      highlightMode: "none",
      viewMode: "focus",
      autoScroll: false,
    });
  });
});

describe("loadSettings / saveSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    const s = { ...DEFAULT_SETTINGS, theme: "sepia" as const, rate: 1.5 };
    saveSettings(s, storage);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it("survives corrupt JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, "{not json");
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("sanitizes stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ fontSize: 1000, theme: "x" }));
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, fontSize: 96 });
  });

  it("does not throw when storage fails", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    storage.failWrites = true;
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, storage)).not.toThrow();
  });

  it("does not return the shared defaults object", () => {
    const s = loadSettings(new MemoryStorage());
    s.fontSize = 50;
    expect(DEFAULT_SETTINGS.fontSize).toBe(28);
  });
});
