"use client";

import { type ReactNode, type RefObject, useId } from "react";
import {
  FONT_CHOICES,
  HIGHLIGHT_MODES,
  SETTING_LIMITS,
  THEMES,
  VIEW_MODES,
  type FontChoice,
  type HighlightMode,
  type ReaderSettings,
  type ViewMode,
} from "@/lib/settings";
import { THEME_LABELS, THEME_TOKENS } from "@/lib/themes";
import { Modal } from "./Modal";
import { formatRate } from "./PlaybackControls";
import { FONT_STACKS } from "./ReaderView";

export const FONT_LABELS: Record<FontChoice, string> = {
  atkinson: "Atkinson Hyperlegible",
  lexend: "Lexend",
  sans: "System sans-serif",
  serif: "Serif",
  mono: "Monospace",
};

export const HIGHLIGHT_LABELS: Record<HighlightMode, string> = {
  both: "Sentence and word",
  sentence: "Sentence only",
  word: "Word only",
  none: "No highlight",
};

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  full: "Full text",
  focus: "Focus (one sentence at a time)",
};

/** Voices split into the browser's language first, then the rest; each sorted by language and name. */
export function groupVoices(
  voices: SpeechSynthesisVoice[],
  browserLang: string,
): { mine: SpeechSynthesisVoice[]; others: SpeechSynthesisVoice[] } {
  const lang = (browserLang || "").toLowerCase();
  const base = lang.split("-")[0];
  const byLangThenName = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) => {
    const exactA = a.lang.toLowerCase() === lang ? 0 : 1;
    const exactB = b.lang.toLowerCase() === lang ? 0 : 1;
    return (
      exactA - exactB || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)
    );
  };
  const mine: SpeechSynthesisVoice[] = [];
  const others: SpeechSynthesisVoice[] = [];
  for (const v of voices) {
    const vBase = (v.lang || "").toLowerCase().split(/[-_]/)[0];
    if (base && vBase === base) mine.push(v);
    else others.push(v);
  }
  return { mine: mine.sort(byLangThenName), others: others.sort(byLangThenName) };
}

const BUTTON =
  "min-h-12 min-w-12 rounded-lg border-2 border-fg bg-surface px-4 py-2 text-lg font-bold text-fg disabled:cursor-not-allowed disabled:opacity-60";
const SELECT = "min-h-12 w-full rounded-lg border-2 border-fg bg-bg px-3 text-lg text-fg";
const RANGE = "h-12 w-full accent-[var(--accent)]";

function Row({ children }: { children: ReactNode }) {
  return <div className="space-y-2 border-b border-fg/30 pb-4">{children}</div>;
}

interface SliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueText: string;
  onChange: (value: number) => void;
}

function Slider({ id, label, value, min, max, step, valueText, onChange }: SliderProps) {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-lg font-bold">
          {label}
        </label>
        <span className="text-lg" aria-hidden="true">
          {valueText}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(Number(e.target.value).toFixed(decimals)))}
        className={RANGE}
      />
    </>
  );
}

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onTextSizeStep: (delta: number) => void;
  onReset: () => void;
  onTestVoice: () => void;
  voices: SpeechSynthesisVoice[];
  speechAvailable: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function SettingsPanel({
  open,
  onClose,
  settings,
  onChange,
  onTextSizeStep,
  onReset,
  onTestVoice,
  voices,
  speechAvailable,
  returnFocusRef,
}: SettingsPanelProps) {
  const uid = useId();
  const id = (part: string) => `${uid}-${part}`;
  const browserLang = typeof navigator !== "undefined" ? navigator.language : "";
  const { mine, others } = groupVoices(voices, browserLang);
  const voiceKnown = !settings.voiceURI || voices.some((v) => v.voiceURI === settings.voiceURI);
  const L = SETTING_LIMITS;

  const voiceOption = (v: SpeechSynthesisVoice) => (
    <option key={v.voiceURI} value={v.voiceURI}>
      {`${v.name} (${v.lang})${v.default ? " – default" : ""}`}
    </option>
  );

  return (
    <Modal open={open} onClose={onClose} title="Settings" returnFocusRef={returnFocusRef}>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <Row>
          <fieldset role="radiogroup" aria-labelledby={id("theme-legend")} className="space-y-2">
            <legend id={id("theme-legend")} className="text-lg font-bold">
              Theme
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {THEMES.map((theme) => {
                const t = THEME_TOKENS[theme];
                return (
                  <label
                    key={theme}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 border-fg px-3 py-2 text-lg"
                  >
                    <input
                      type="radio"
                      name={id("theme")}
                      value={theme}
                      checked={settings.theme === theme}
                      onChange={() => onChange({ theme })}
                      className="h-6 w-6 accent-[var(--accent)]"
                    />
                    <span
                      aria-hidden="true"
                      data-swatch={theme}
                      className="inline-flex h-10 w-14 items-center justify-center rounded-md border-2 font-bold"
                      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.fg }}
                    >
                      Aa
                    </span>
                    <span>{THEME_LABELS[theme]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </Row>

        <Row>
          <Slider
            id={id("size")}
            label="Text size"
            value={settings.fontSize}
            min={L.fontSize.min}
            max={L.fontSize.max}
            step={1}
            valueText={`${settings.fontSize} pixels`}
            onChange={(fontSize) => onChange({ fontSize })}
          />
          <div className="flex gap-3">
            <button type="button" className={BUTTON} onClick={() => onTextSizeStep(-4)}>
              Smaller
            </button>
            <button type="button" className={BUTTON} onClick={() => onTextSizeStep(4)}>
              Larger
            </button>
          </div>
        </Row>

        <Row>
          <Slider
            id={id("line")}
            label="Line spacing"
            value={settings.lineHeight}
            min={L.lineHeight.min}
            max={L.lineHeight.max}
            step={0.1}
            valueText={settings.lineHeight.toFixed(1)}
            onChange={(lineHeight) => onChange({ lineHeight })}
          />
        </Row>

        <Row>
          <Slider
            id={id("letter")}
            label="Letter spacing"
            value={settings.letterSpacing}
            min={L.letterSpacing.min}
            max={L.letterSpacing.max}
            step={0.01}
            valueText={`${settings.letterSpacing.toFixed(2)} em`}
            onChange={(letterSpacing) => onChange({ letterSpacing })}
          />
        </Row>

        <Row>
          <Slider
            id={id("word")}
            label="Word spacing"
            value={settings.wordSpacing}
            min={L.wordSpacing.min}
            max={L.wordSpacing.max}
            step={0.05}
            valueText={`${settings.wordSpacing.toFixed(2)} em`}
            onChange={(wordSpacing) => onChange({ wordSpacing })}
          />
        </Row>

        <Row>
          <label htmlFor={id("font")} className="block text-lg font-bold">
            Font
          </label>
          <select
            id={id("font")}
            value={settings.fontFamily}
            onChange={(e) => onChange({ fontFamily: e.target.value as FontChoice })}
            className={SELECT}
            style={{ fontFamily: FONT_STACKS[settings.fontFamily] }}
          >
            {FONT_CHOICES.map((f) => (
              <option key={f} value={f}>
                {FONT_LABELS[f]}
              </option>
            ))}
          </select>
        </Row>

        <Row>
          <Slider
            id={id("rate")}
            label="Reading speed"
            value={settings.rate}
            min={L.rate.min}
            max={L.rate.max}
            step={0.1}
            valueText={formatRate(settings.rate)}
            onChange={(rate) => onChange({ rate })}
          />
        </Row>

        <Row>
          <Slider
            id={id("pitch")}
            label="Pitch"
            value={settings.pitch}
            min={L.pitch.min}
            max={L.pitch.max}
            step={0.1}
            valueText={settings.pitch.toFixed(1)}
            onChange={(pitch) => onChange({ pitch })}
          />
        </Row>

        <Row>
          <Slider
            id={id("volume")}
            label="Volume"
            value={settings.volume}
            min={L.volume.min}
            max={L.volume.max}
            step={0.05}
            valueText={`${Math.round(settings.volume * 100)}%`}
            onChange={(volume) => onChange({ volume })}
          />
        </Row>

        <Row>
          <label htmlFor={id("voice")} className="block text-lg font-bold">
            Voice
          </label>
          <select
            id={id("voice")}
            value={voiceKnown ? (settings.voiceURI ?? "") : ""}
            onChange={(e) => onChange({ voiceURI: e.target.value || null })}
            className={SELECT}
          >
            <option value="">Browser default</option>
            {mine.length > 0 && (
              <optgroup label={`Your language (${browserLang})`}>{mine.map(voiceOption)}</optgroup>
            )}
            {others.length > 0 && (
              <optgroup label={mine.length > 0 ? "Other languages" : "All voices"}>
                {others.map(voiceOption)}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className={BUTTON}
            onClick={onTestVoice}
            disabled={!speechAvailable}
          >
            Test voice
          </button>
        </Row>

        <Row>
          <label htmlFor={id("highlight")} className="block text-lg font-bold">
            Highlight
          </label>
          <select
            id={id("highlight")}
            value={settings.highlightMode}
            onChange={(e) => onChange({ highlightMode: e.target.value as HighlightMode })}
            className={SELECT}
          >
            {HIGHLIGHT_MODES.map((m) => (
              <option key={m} value={m}>
                {HIGHLIGHT_LABELS[m]}
              </option>
            ))}
          </select>
        </Row>

        <Row>
          <label htmlFor={id("view")} className="block text-lg font-bold">
            View mode
          </label>
          <select
            id={id("view")}
            value={settings.viewMode}
            onChange={(e) => onChange({ viewMode: e.target.value as ViewMode })}
            className={SELECT}
          >
            {VIEW_MODES.map((m) => (
              <option key={m} value={m}>
                {VIEW_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </Row>

        <Row>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 text-lg font-bold">
            <input
              type="checkbox"
              checked={settings.autoScroll}
              onChange={(e) => onChange({ autoScroll: e.target.checked })}
              className="h-6 w-6 accent-[var(--accent)]"
            />
            Auto-scroll
          </label>
        </Row>

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" className={BUTTON} onClick={onReset}>
            Reset to defaults
          </button>
        </div>
      </div>
    </Modal>
  );
}
