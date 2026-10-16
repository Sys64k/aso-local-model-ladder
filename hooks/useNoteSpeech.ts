"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SpeechController,
  type SpeechControllerDeps,
  type SpeechOptions,
  type SpeechStatus,
} from "@/lib/speech/controller";

export interface UseNoteSpeechResult {
  status: SpeechStatus;
  /** Load `text` and start reading it from the first sentence. */
  read: (text: string) => void;
  /** Stop reading (no-op while idle). */
  stop: () => void;
}

/**
 * Reads a note aloud with its own SpeechController.
 *
 * The document's `useSpeech` can't be reused for this: `SpeechController.load()`
 * and `stop()` always call `speechSynthesis.cancel()`, so a controller fed the
 * live note text would cancel the document's speech on every keystroke. This
 * controller only loads text when `read()` is called and only stops while it is
 * actually speaking.
 *
 * The controller is created after mount (nothing touches `window` during
 * server render) and disposed on unmount.
 */
export function useNoteSpeech(
  options: SpeechOptions,
  deps?: SpeechControllerDeps,
): UseNoteSpeechResult {
  const [controller, setController] = useState<SpeechController | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");

  // Latest values for the mount effect without re-running it.
  const latest = useRef({ options, deps });
  useEffect(() => {
    latest.current = { options, deps };
  });

  useEffect(() => {
    const { options: o, deps: d } = latest.current;
    const c = new SpeechController(d);
    c.setOptions(o);
    const unsubscribe = c.subscribe((s) => setStatus(s.status));
    setController(c);
    return () => {
      unsubscribe();
      c.dispose();
    };
  }, []);

  const { rate, pitch, volume, voiceURI } = options;
  useEffect(() => {
    controller?.setOptions({ rate, pitch, volume, voiceURI });
  }, [controller, rate, pitch, volume, voiceURI]);

  const read = useCallback(
    (text: string) => {
      if (!controller) return;
      controller.load(text);
      controller.play(0);
    },
    [controller],
  );

  const stop = useCallback(() => {
    // stop() cancels the shared speech engine; only do that while the note is
    // actually being read so the document's speech is left alone.
    if (!controller || controller.getState().status === "idle") return;
    controller.stop();
  }, [controller]);

  return { status, read, stop };
}
