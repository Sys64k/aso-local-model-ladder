// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useSettings } from "./useSettings";
import { useSpeech } from "./useSpeech";
import { useVoices } from "./useVoices";

function Probe() {
  const { settings } = useSettings();
  const { sentences, supported, state } = useSpeech("Hello there. General Kenobi.", {
    rate: 1,
    pitch: 1,
    volume: 1,
    voiceURI: null,
  });
  const voices = useVoices();
  return (
    <p>
      {`${settings.fontFamily}|${sentences.length}|${state.status}|${supported}|${voices.length}`}
    </p>
  );
}

describe("hooks during server render", () => {
  it("render without window, localStorage or speechSynthesis", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(<Probe />);
    expect(html).toContain("atkinson|2|idle|false|0");
  });
});
