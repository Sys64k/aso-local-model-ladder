"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SpeechController,
  type SpeechControllerDeps,
  type SpeechOptions,
  type SpeechState,
} from "@/lib/speech/controller";
import { splitSentences, type Sentence } from "@/lib/text/segment";

export interface UseSpeechResult {
  state: SpeechState;
  sentences: Sentence[];
  supported: boolean;
  play: (fromSentence?: number) => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
}

/**
 * Read `text` aloud sentence by sentence. The controller is created after
 * mount (nothing touches `window` during server render) and disposed on
 * unmount.
 *
 * @param deps optional injected synth/Utterance (tests).
 */
export function useSpeech(
  text: string,
  options: SpeechOptions,
  deps?: SpeechControllerDeps,
): UseSpeechResult {
  // Same deterministic split the controller uses, available on the first render.
  const sentences = useMemo(() => splitSentences(text), [text]);
  const [controller, setController] = useState<SpeechController | null>(null);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<SpeechState>(() => ({
    status: "idle",
    sentenceIndex: 0,
    sentenceCount: sentences.length,
    wordRange: null,
    error: null,
  }));

  // Latest values for the mount effect without re-running it.
  const latest = useRef({ text, options, deps });
  useEffect(() => {
    latest.current = { text, options, deps };
  });

  /** Text currently loaded into the controller. */
  const loadedText = useRef<string | null>(null);

  useEffect(() => {
    const { text: t, options: o, deps: d } = latest.current;
    const c = new SpeechController(d);
    c.setOptions(o);
    c.load(t);
    loadedText.current = t;
    setState(c.getState());
    const unsubscribe = c.subscribe(setState);
    setController(c);
    setSupported(Boolean(d?.synth) || SpeechController.isSupported());
    return () => {
      unsubscribe();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    if (!controller || loadedText.current === text) return;
    controller.load(text);
    loadedText.current = text;
  }, [controller, text]);

  const { rate, pitch, volume, voiceURI } = options;
  useEffect(() => {
    controller?.setOptions({ rate, pitch, volume, voiceURI });
  }, [controller, rate, pitch, volume, voiceURI]);

  const play = useCallback((from?: number) => controller?.play(from), [controller]);
  const pause = useCallback(() => controller?.pause(), [controller]);
  const resume = useCallback(() => controller?.resume(), [controller]);
  const toggle = useCallback(() => controller?.toggle(), [controller]);
  const stop = useCallback(() => controller?.stop(), [controller]);
  const next = useCallback(() => controller?.next(), [controller]);
  const previous = useCallback(() => controller?.previous(), [controller]);
  const jumpTo = useCallback((i: number) => controller?.jumpTo(i), [controller]);

  return {
    state,
    sentences,
    supported,
    play,
    pause,
    resume,
    toggle,
    stop,
    next,
    previous,
    jumpTo,
  };
}
