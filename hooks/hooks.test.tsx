import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "@/lib/settings";
import type { SpeechOptions } from "@/lib/speech/controller";
import {
  createFakeSpeech,
  fakeVoice,
  installFakeSpeech,
} from "@/tests/fakes/speechSynthesis";
import { MemoryStorage } from "@/tests/fakes/storage";
import { useSettings } from "./useSettings";
import { useSpeech } from "./useSpeech";
import { useVoices } from "./useVoices";

const OPTIONS: SpeechOptions = { rate: 1, pitch: 1, volume: 1, voiceURI: null };
const TEXT = "One sentence. Two sentence. Three.";

describe("useSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads stored settings after mount", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: "dark", fontSize: 40 }));
    const { result } = renderHook(() => useSettings(storage));
    expect(result.current.settings).toMatchObject({ theme: "dark", fontSize: 40 });
  });

  it("does not overwrite stored settings with defaults on mount", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: "sepia" }));
    renderHook(() => useSettings(storage));
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!).theme).toBe("sepia");
  });

  it("updates (sanitized) and saves on change, and resets", () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useSettings(storage));
    act(() => result.current.update({ fontSize: 500, theme: "high-contrast" }));
    expect(result.current.settings).toMatchObject({ fontSize: 96, theme: "high-contrast" });
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
      fontSize: 96,
      theme: "high-contrast",
    });
    act(() => result.current.reset());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(DEFAULT_SETTINGS);
  });

  it("uses window.localStorage by default", () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ rate: 1.5 }));
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings.rate).toBe(1.5);
    act(() => result.current.update({ viewMode: "focus" }));
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!).viewMode).toBe("focus");
  });

  it("keeps working when storage throws", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    storage.failWrites = true;
    const { result } = renderHook(() => useSettings(storage));
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    act(() => result.current.update({ theme: "dark" }));
    expect(result.current.settings.theme).toBe("dark");
  });
});

describe("useSpeech", () => {
  let installed: ReturnType<typeof installFakeSpeech>;

  beforeEach(() => {
    installed = installFakeSpeech();
  });

  afterEach(() => {
    installed.restore();
  });

  it("exposes sentences, support and idle state", () => {
    const { result } = renderHook(() => useSpeech(TEXT, OPTIONS));
    expect(result.current.supported).toBe(true);
    expect(result.current.sentences.map((s) => s.text)).toEqual([
      "One sentence.",
      "Two sentence.",
      "Three.",
    ]);
    expect(result.current.state).toMatchObject({
      status: "idle",
      sentenceIndex: 0,
      sentenceCount: 3,
    });
  });

  it("plays, follows controller state and supports the transport controls", () => {
    const { fake } = installed;
    const { result } = renderHook(() => useSpeech(TEXT, OPTIONS));
    act(() => result.current.play());
    expect(result.current.state.status).toBe("playing");
    expect(fake.spokenTexts).toEqual(["One sentence."]);

    act(() => fake.fireBoundary(4, 8));
    expect(result.current.state.wordRange).toEqual({ start: 4, end: 12 });

    act(() => fake.finishCurrent());
    expect(result.current.state.sentenceIndex).toBe(1);

    act(() => result.current.pause());
    expect(result.current.state.status).toBe("paused");
    act(() => result.current.resume());
    expect(result.current.state.status).toBe("playing");
    act(() => result.current.toggle());
    expect(result.current.state.status).toBe("paused");
    act(() => result.current.toggle());

    act(() => result.current.next());
    expect(result.current.state.sentenceIndex).toBe(2);
    act(() => result.current.previous());
    expect(result.current.state.sentenceIndex).toBe(1);
    act(() => result.current.jumpTo(0));
    expect(result.current.state.sentenceIndex).toBe(0);
    expect(fake.lastSpoken?.text).toBe("One sentence.");

    act(() => result.current.stop());
    expect(result.current.state.status).toBe("idle");
  });

  it("reloads when the text changes", () => {
    const { fake } = installed;
    const { result, rerender } = renderHook(({ text }) => useSpeech(text, OPTIONS), {
      initialProps: { text: TEXT },
    });
    act(() => result.current.play());
    rerender({ text: "Brand new. Text here." });
    expect(result.current.sentences.map((s) => s.text)).toEqual(["Brand new.", "Text here."]);
    expect(result.current.state).toMatchObject({
      status: "idle",
      sentenceIndex: 0,
      sentenceCount: 2,
    });
    act(() => result.current.play());
    expect(fake.lastSpoken?.text).toBe("Brand new.");
  });

  it("does not reload when re-rendered with the same text", () => {
    const { result, rerender } = renderHook(({ text }) => useSpeech(text, OPTIONS), {
      initialProps: { text: TEXT },
    });
    act(() => result.current.play(1));
    rerender({ text: TEXT });
    expect(result.current.state).toMatchObject({ status: "playing", sentenceIndex: 1 });
  });

  it("restarts the current sentence when options change during playback", () => {
    const { fake } = installed;
    const { result, rerender } = renderHook(({ options }) => useSpeech(TEXT, options), {
      initialProps: { options: OPTIONS },
    });
    act(() => result.current.play(1));
    expect(fake.spoken).toHaveLength(1);
    // A new object with the same values does not restart.
    rerender({ options: { ...OPTIONS } });
    expect(fake.spoken).toHaveLength(1);
    rerender({ options: { ...OPTIONS, rate: 1.5 } });
    expect(fake.spoken).toHaveLength(2);
    expect(fake.lastSpoken?.text).toBe("Two sentence.");
    expect(fake.lastSpoken?.rate).toBe(1.5);
  });

  it("uses the initial options for the first utterance", () => {
    const { fake } = installed;
    const { result } = renderHook(() => useSpeech(TEXT, { ...OPTIONS, pitch: 1.4 }));
    act(() => result.current.play());
    expect(fake.lastSpoken?.pitch).toBe(1.4);
    expect(fake.spoken).toHaveLength(1);
  });

  it("disposes the controller on unmount", () => {
    const { fake } = installed;
    const { result, unmount } = renderHook(() => useSpeech(TEXT, OPTIONS));
    act(() => result.current.play());
    const cancels = fake.calls.filter((c) => c === "cancel").length;
    unmount();
    expect(fake.calls.filter((c) => c === "cancel").length).toBeGreaterThan(cancels);
    expect(fake.speaking).toBe(false);
  });

  it("accepts injected dependencies", () => {
    installed.restore();
    const { fake, synth, Utterance } = createFakeSpeech();
    const { result } = renderHook(() => useSpeech(TEXT, OPTIONS, { synth, Utterance }));
    expect(result.current.supported).toBe(true);
    act(() => result.current.play());
    expect(fake.spokenTexts).toEqual(["One sentence."]);
    installed = installFakeSpeech();
  });

  it("reports unsupported when there is no speech synthesis", () => {
    installed.restore();
    const { result } = renderHook(() => useSpeech(TEXT, OPTIONS));
    expect(result.current.supported).toBe(false);
    act(() => result.current.play());
    expect(result.current.state.error).toMatch(/not supported/);
    installed = installFakeSpeech();
  });
});

describe("useVoices", () => {
  it("returns voices and updates on voiceschanged", () => {
    const { fake, synth } = createFakeSpeech();
    const { result, unmount } = renderHook(() => useVoices(synth));
    expect(result.current).toEqual([]);
    const v = fakeVoice({ name: "Bob" });
    act(() => fake.setVoices([v]));
    expect(result.current).toEqual([v]);
    unmount();
    expect(fake.listenerCount("voiceschanged")).toBe(0);
  });

  it("reads window.speechSynthesis by default", () => {
    const v = fakeVoice({ name: "Global" });
    const installed = installFakeSpeech({ voices: [v] });
    try {
      const { result } = renderHook(() => useVoices());
      expect(result.current).toEqual([v]);
    } finally {
      installed.restore();
    }
  });

  it("returns an empty list without speech synthesis", () => {
    const { result } = renderHook(() => useVoices());
    expect(result.current).toEqual([]);
  });
});

describe("server render safety (in a DOM environment)", () => {
  it("does not read localStorage or speechSynthesis while rendering to string", async () => {
    const { renderToString } = await import("react-dom/server");
    const installed = installFakeSpeech();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const speak = vi.spyOn(installed.fake, "getVoices");
    function Probe() {
      const { settings } = useSettings();
      const { sentences, supported } = useSpeech(TEXT, OPTIONS);
      const voices = useVoices();
      return <p>{`${settings.theme}|${sentences.length}|${supported}|${voices.length}`}</p>;
    }
    try {
      const html = renderToString(<Probe />);
      expect(html).toContain("light|3|false|0");
      expect(getItem).not.toHaveBeenCalled();
      expect(speak).not.toHaveBeenCalled();
      expect(installed.fake.calls).toEqual([]);
    } finally {
      getItem.mockRestore();
      installed.restore();
    }
  });
});
