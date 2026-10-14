import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSpeech,
  fakeVoice,
  installFakeSpeech,
  type FakeSpeechOptions,
  type FakeSpeechSynthesis,
} from "@/tests/fakes/speechSynthesis";
import { SpeechController, loadVoices, type SpeechState } from "./controller";

const TEXT = "First sentence here. Second one now. Third and last.";

function setup(opts: FakeSpeechOptions = {}, text = TEXT) {
  const { fake, synth, Utterance } = createFakeSpeech(opts);
  const controller = new SpeechController({ synth, Utterance });
  const states: SpeechState[] = [];
  controller.subscribe((s) => states.push(s));
  controller.load(text);
  return { fake, controller, states };
}

function lastText(fake: FakeSpeechSynthesis) {
  return fake.lastSpoken?.text;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SpeechController basics", () => {
  it("loads text into sentences and reports idle state", () => {
    const { controller } = setup();
    expect(controller.getSentences().map((s) => s.text)).toEqual([
      "First sentence here.",
      "Second one now.",
      "Third and last.",
    ]);
    expect(controller.getState()).toEqual({
      status: "idle",
      sentenceIndex: 0,
      sentenceCount: 3,
      wordRange: null,
      error: null,
    });
  });

  it("speaks sentences in order and goes idle after the last one", () => {
    const { fake, controller, states } = setup();
    controller.play();
    expect(controller.getState().status).toBe("playing");
    expect(lastText(fake)).toBe("First sentence here.");
    fake.finishCurrent();
    expect(controller.getState().sentenceIndex).toBe(1);
    expect(lastText(fake)).toBe("Second one now.");
    fake.finishCurrent();
    expect(lastText(fake)).toBe("Third and last.");
    fake.finishCurrent();
    expect(fake.spokenTexts).toEqual([
      "First sentence here.",
      "Second one now.",
      "Third and last.",
    ]);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      sentenceIndex: 2,
      wordRange: null,
    });
    expect(states.map((s) => s.sentenceIndex)).toContain(1);
    expect(states.some((s) => s.status === "playing")).toBe(true);
  });

  it("plays automatically on timers with the fake synth", () => {
    vi.useFakeTimers();
    const { fake, controller } = setup({ auto: true, wordIntervalMs: 10 });
    controller.play();
    vi.advanceTimersByTime(10_000);
    expect(fake.spokenTexts).toHaveLength(3);
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().sentenceIndex).toBe(2);
  });

  it("restarts from the beginning when play() is called after finishing", () => {
    const { fake, controller } = setup();
    controller.play(2);
    fake.finishCurrent();
    expect(controller.getState().status).toBe("idle");
    controller.play();
    expect(controller.getState().sentenceIndex).toBe(0);
    expect(lastText(fake)).toBe("First sentence here.");
  });

  it("plays from a given sentence (clamped)", () => {
    const { fake, controller } = setup();
    controller.play(1);
    expect(lastText(fake)).toBe("Second one now.");
    controller.play(99);
    expect(controller.getState().sentenceIndex).toBe(2);
    expect(lastText(fake)).toBe("Third and last.");
  });

  it("applies options to utterances", () => {
    const voice = fakeVoice({ name: "Alice", voiceURI: "alice", lang: "en-GB" });
    const { fake, controller } = setup({ voices: [voice] });
    controller.setOptions({ rate: 1.5, pitch: 0.8, volume: 0.5, voiceURI: "alice" });
    controller.play();
    const u = fake.lastSpoken!;
    expect(u.rate).toBe(1.5);
    expect(u.pitch).toBe(0.8);
    expect(u.volume).toBe(0.5);
    expect(u.voice).toBe(voice);
    expect(u.lang).toBe("en-GB");
  });

  it("does nothing on play() with no text", () => {
    const { fake, controller } = setup({}, "   ");
    controller.play();
    expect(fake.spoken).toHaveLength(0);
    expect(controller.getState().status).toBe("idle");
  });

  it("reports an error when speech synthesis is unavailable", () => {
    const controller = new SpeechController({});
    controller.load(TEXT);
    controller.play();
    expect(controller.getState().error).toMatch(/not supported/);
    expect(controller.getState().status).toBe("idle");
  });

  it("unsubscribes listeners", () => {
    const { controller } = setup();
    const listener = vi.fn();
    const off = controller.subscribe(listener);
    controller.play();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    off();
    controller.stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("isSupported reflects the global environment", () => {
    expect(SpeechController.isSupported()).toBe(false);
    const installed = installFakeSpeech();
    try {
      expect(SpeechController.isSupported()).toBe(true);
      const c = new SpeechController();
      c.load(TEXT);
      c.play();
      expect(installed.fake.spokenTexts).toEqual(["First sentence here."]);
      c.dispose();
    } finally {
      installed.restore();
    }
    expect(SpeechController.isSupported()).toBe(false);
  });
});

describe("word boundaries", () => {
  it("reports wordRange as absolute offsets using charLength", () => {
    const { fake, controller } = setup();
    controller.play(1);
    // "Second one now." starts at offset 21
    fake.fireBoundary(7, 3);
    expect(controller.getState().wordRange).toEqual({ start: 28, end: 31 });
    expect(TEXT.slice(28, 31)).toBe("one");
  });

  it("runs to the next whitespace when charLength is missing", () => {
    const { fake, controller } = setup();
    controller.play();
    fake.fireBoundary(6);
    expect(controller.getState().wordRange).toEqual({ start: 6, end: 14 });
    expect(TEXT.slice(6, 14)).toBe("sentence");
  });

  it("ignores non-word boundaries and resets wordRange per sentence", () => {
    const { fake, controller } = setup();
    controller.play();
    fake.fireBoundary(0, 20, "sentence");
    expect(controller.getState().wordRange).toBeNull();
    fake.fireWord();
    expect(controller.getState().wordRange).toEqual({ start: 0, end: 5 });
    fake.finishCurrent();
    expect(controller.getState().wordRange).toBeNull();
  });

  it("maps offsets correctly for later paragraphs", () => {
    const text = "Intro.\n\n  Para two has words.";
    const { fake, controller } = setup({}, text);
    controller.play(1);
    fake.fireBoundary(9, 3);
    const r = controller.getState().wordRange!;
    expect(text.slice(r.start, r.end)).toBe("has");
  });
});

describe("transport controls", () => {
  it("pauses and resumes with synth.pause()/resume()", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.pause();
    expect(fake.calls).toContain("pause");
    expect(fake.paused).toBe(true);
    expect(controller.getState().status).toBe("paused");
    const spokenBefore = fake.spoken.length;
    controller.resume();
    expect(fake.calls[fake.calls.length - 1]).toBe("resume");
    expect(controller.getState().status).toBe("playing");
    expect(fake.spoken.length).toBe(spokenBefore);
  });

  it("toggle cycles play/pause/resume", () => {
    const { fake, controller } = setup();
    controller.toggle();
    expect(controller.getState().status).toBe("playing");
    controller.toggle();
    expect(controller.getState().status).toBe("paused");
    controller.toggle();
    expect(controller.getState().status).toBe("playing");
    expect(fake.spoken).toHaveLength(1);
  });

  it("play() while paused resumes", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.pause();
    controller.play();
    expect(controller.getState().status).toBe("playing");
    expect(fake.spoken).toHaveLength(1);
  });

  it("next/previous while playing speak the target sentence immediately", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.next();
    expect(controller.getState().sentenceIndex).toBe(1);
    expect(lastText(fake)).toBe("Second one now.");
    controller.next();
    expect(lastText(fake)).toBe("Third and last.");
    controller.next(); // already at the end: no-op
    expect(controller.getState().sentenceIndex).toBe(2);
    expect(fake.spoken).toHaveLength(3);
    controller.previous();
    expect(controller.getState().sentenceIndex).toBe(1);
    expect(lastText(fake)).toBe("Second one now.");
    expect(controller.getState().status).toBe("playing");
  });

  it("next/previous/jumpTo while idle only move the position", () => {
    const { fake, controller } = setup();
    controller.next();
    expect(controller.getState().sentenceIndex).toBe(1);
    controller.previous();
    controller.previous();
    expect(controller.getState().sentenceIndex).toBe(0);
    controller.jumpTo(2);
    expect(controller.getState()).toMatchObject({ sentenceIndex: 2, status: "idle" });
    expect(fake.spoken).toHaveLength(0);
    controller.play();
    expect(lastText(fake)).toBe("Third and last.");
  });

  it("jumpTo while playing starts the target sentence straight away", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.jumpTo(2);
    expect(lastText(fake)).toBe("Third and last.");
    expect(controller.getState()).toMatchObject({ sentenceIndex: 2, status: "playing" });
    controller.jumpTo(-5);
    expect(controller.getState().sentenceIndex).toBe(0);
    expect(lastText(fake)).toBe("First sentence here.");
  });

  it("jumping while paused stays paused and speaks the new sentence on resume", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.pause();
    controller.jumpTo(2);
    expect(controller.getState()).toMatchObject({ status: "paused", sentenceIndex: 2 });
    expect(fake.spoken).toHaveLength(1);
    controller.resume();
    expect(controller.getState().status).toBe("playing");
    expect(lastText(fake)).toBe("Third and last.");
    expect(fake.paused).toBe(false);
  });

  it("stop cancels speech, keeps the position and goes idle", () => {
    const { fake, controller } = setup();
    controller.play(1);
    fake.fireBoundary(0, 6);
    controller.stop();
    expect(fake.calls).toContain("cancel");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      sentenceIndex: 1,
      wordRange: null,
    });
    // A late end event from the cancelled utterance must not restart playback.
    fake.fireEnd(fake.cancelled[fake.cancelled.length - 1]);
    expect(controller.getState().status).toBe("idle");
    expect(fake.spoken).toHaveLength(1);
  });

  it("stop while paused un-pauses the synth", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.pause();
    controller.stop();
    expect(fake.paused).toBe(false);
    expect(controller.getState().status).toBe("idle");
  });

  it("load() stops playback and resets the position", () => {
    const { fake, controller } = setup();
    controller.play(2);
    controller.load("New text. Two.");
    expect(fake.calls).toContain("cancel");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      sentenceIndex: 0,
      sentenceCount: 2,
    });
  });
});

describe("options and stale events", () => {
  it("restarts the current sentence when options change during playback", () => {
    const { fake, controller } = setup();
    controller.play(1);
    expect(fake.spoken).toHaveLength(1);
    controller.setOptions({ rate: 1.75 });
    expect(fake.spoken).toHaveLength(2);
    expect(lastText(fake)).toBe("Second one now.");
    expect(fake.lastSpoken!.rate).toBe(1.75);
    expect(controller.getState()).toMatchObject({ status: "playing", sentenceIndex: 1 });
  });

  it("does not restart when options are unchanged or when idle", () => {
    const { fake, controller } = setup();
    controller.setOptions({ rate: 2 });
    expect(fake.spoken).toHaveLength(0);
    controller.play();
    controller.setOptions({ rate: 2, pitch: undefined });
    expect(fake.spoken).toHaveLength(1);
    expect(controller.getOptions().rate).toBe(2);
  });

  it("applies option changes made while paused on resume", () => {
    const { fake, controller } = setup();
    controller.play();
    controller.pause();
    controller.setOptions({ volume: 0.3 });
    expect(fake.spoken).toHaveLength(1);
    controller.resume();
    expect(fake.spoken).toHaveLength(2);
    expect(fake.lastSpoken!.volume).toBe(0.3);
    expect(lastText(fake)).toBe("First sentence here.");
  });

  it("ignores end/boundary/error events from cancelled utterances", () => {
    const { fake, controller } = setup({ cancelEvent: "end" });
    controller.play();
    const first = fake.lastSpoken!;
    controller.setOptions({ rate: 1.2 }); // cancel fires a synchronous (stale) 'end'
    expect(controller.getState().sentenceIndex).toBe(0);
    expect(lastText(fake)).toBe("First sentence here.");

    fake.fireEnd(first);
    fake.fireEnd(first);
    expect(controller.getState().sentenceIndex).toBe(0);
    fake.fireBoundary(6, 8, "word", first);
    expect(controller.getState().wordRange).toBeNull();
    fake.fireError("synthesis-failed", first);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().status).toBe("playing");
    expect(fake.spoken).toHaveLength(2);

    // The live utterance still advances playback.
    fake.finishCurrent();
    expect(controller.getState().sentenceIndex).toBe(1);
  });

  it("treats interrupted/canceled errors as non-errors", () => {
    const { fake, controller } = setup();
    controller.play();
    fake.lastSpoken!.dispatch("error", { error: "interrupted" });
    fake.lastSpoken!.dispatch("error", { error: "canceled" });
    expect(controller.getState()).toMatchObject({ status: "playing", error: null });
  });

  it("other errors set state.error and stop", () => {
    const { fake, controller } = setup();
    controller.play();
    fake.fireError("audio-busy");
    expect(controller.getState()).toMatchObject({
      status: "idle",
      error: "audio-busy",
      sentenceIndex: 0,
    });
    controller.play();
    expect(controller.getState().error).toBeNull();
  });
});

describe("Chrome long-pause workaround", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("re-speaks the current sentence when resume does not restart speech", () => {
    const { synth, Utterance, fake } = createFakeSpeech({ brokenResume: true });
    const controller = new SpeechController({ synth, Utterance, resumeCheckMs: 300 });
    controller.load(TEXT);
    controller.play(1);
    controller.pause();
    vi.advanceTimersByTime(20_000);
    controller.resume();
    expect(fake.spoken).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(fake.spoken).toHaveLength(2);
    expect(lastText(fake)).toBe("Second one now.");
    expect(controller.getState()).toMatchObject({ status: "playing", sentenceIndex: 1 });
  });

  it("does not re-speak when resume works", () => {
    const { synth, Utterance, fake } = createFakeSpeech({ auto: true, wordIntervalMs: 50 });
    const controller = new SpeechController({ synth, Utterance, resumeCheckMs: 300 });
    controller.load(TEXT);
    controller.play();
    vi.advanceTimersByTime(120);
    controller.pause();
    vi.advanceTimersByTime(1000);
    controller.resume();
    vi.advanceTimersByTime(300);
    // The first sentence was never re-spoken; playback simply moved on.
    expect(fake.spokenTexts.filter((t) => t === "First sentence here.")).toHaveLength(1);
    expect(fake.spokenTexts[1]).toBe("Second one now.");
  });

  it("does not re-speak if the user paused again before the check", () => {
    const { synth, Utterance, fake } = createFakeSpeech({ brokenResume: true });
    const controller = new SpeechController({ synth, Utterance, resumeCheckMs: 300 });
    controller.load(TEXT);
    controller.play();
    controller.pause();
    controller.resume();
    controller.pause();
    vi.advanceTimersByTime(1000);
    expect(fake.spoken).toHaveLength(1);
    expect(controller.getState().status).toBe("paused");
  });
});

describe("dispose", () => {
  it("cancels speech and stops notifying", () => {
    const { fake, controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.play();
    listener.mockClear();
    controller.dispose();
    expect(fake.calls[fake.calls.length - 1]).toBe("cancel");
    expect(listener).not.toHaveBeenCalled();
    controller.play();
    expect(fake.spoken).toHaveLength(1);
  });
});

describe("loadVoices", () => {
  it("resolves immediately when voices are available", async () => {
    const v = fakeVoice();
    const { synth } = createFakeSpeech({ voices: [v] });
    await expect(loadVoices(synth)).resolves.toEqual([v]);
  });

  it("waits for voiceschanged when the list is empty at first", async () => {
    const { synth, fake } = createFakeSpeech();
    const promise = loadVoices(synth, 5000);
    expect(fake.listenerCount("voiceschanged")).toBe(1);
    const v = fakeVoice({ name: "Late" });
    fake.setVoices([v]);
    await expect(promise).resolves.toEqual([v]);
    expect(fake.listenerCount("voiceschanged")).toBe(0);
  });

  it("resolves with an empty list after the timeout", async () => {
    vi.useFakeTimers();
    const { synth } = createFakeSpeech();
    const promise = loadVoices(synth, 100);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toEqual([]);
  });

  it("resolves empty without a synth", async () => {
    await expect(loadVoices(undefined)).resolves.toEqual([]);
  });
});
