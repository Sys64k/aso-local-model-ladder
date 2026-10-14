"use client";

import { useEffect, useState } from "react";

function getSynth(): SpeechSynthesis | undefined {
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      return window.speechSynthesis;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * The available speech synthesis voices. Empty during server render and until
 * the browser has loaded its voices; updates on `voiceschanged`.
 *
 * @param synth optional injected SpeechSynthesis (tests).
 */
export function useVoices(synth?: SpeechSynthesis): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const s = synth ?? getSynth();
    if (!s) return;
    let active = true;
    const update = () => {
      if (!active) return;
      try {
        setVoices(s.getVoices() ?? []);
      } catch {
        setVoices([]);
      }
    };
    update();
    s.addEventListener?.("voiceschanged", update);
    return () => {
      active = false;
      s.removeEventListener?.("voiceschanged", update);
    };
  }, [synth]);

  return voices;
}
