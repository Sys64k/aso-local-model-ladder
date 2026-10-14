"use client";

import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { FontChoice, ReaderSettings } from "@/lib/settings";
import { splitParagraphs, type Sentence } from "@/lib/text/segment";

export const FONT_STACKS: Record<FontChoice, string> = {
  atkinson: "var(--font-atkinson), ui-sans-serif, system-ui, sans-serif",
  lexend: "var(--font-lexend), ui-sans-serif, system-ui, sans-serif",
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'var(--font-serif), Georgia, "Times New Roman", serif',
  mono: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/** CSS variables applied on the reader root. */
export function readerStyle(settings: ReaderSettings): CSSProperties {
  return {
    "--reader-font-size": `${settings.fontSize}px`,
    "--reader-line-height": String(settings.lineHeight),
    "--reader-letter-spacing": `${settings.letterSpacing}em`,
    "--reader-word-spacing": `${settings.wordSpacing}em`,
    "--reader-font": FONT_STACKS[settings.fontFamily],
  } as CSSProperties;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export interface ReaderViewProps {
  text: string;
  currentIndex: number;
  wordRange: { start: number; end: number } | null;
  settings: ReaderSettings;
  /** Click on a sentence, or Enter on the reader region. */
  onActivate: (index: number) => void;
}

export function ReaderView({ text, currentIndex, wordRange, settings, onActivate }: ReaderViewProps) {
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  const sentences = useMemo(() => paragraphs.flatMap((p) => p.sentences), [paragraphs]);
  const containerRef = useRef<HTMLElement>(null);
  const { highlightMode, viewMode, autoScroll } = settings;
  const sentenceHighlight = highlightMode === "sentence" || highlightMode === "both";
  const wordHighlight = highlightMode === "word" || highlightMode === "both";

  const prevIndex = useRef<number | null>(null);
  useEffect(() => {
    const changed = prevIndex.current !== null && prevIndex.current !== currentIndex;
    prevIndex.current = currentIndex;
    if (!changed || !autoScroll || viewMode === "focus") return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-sentence-index="${currentIndex}"]`,
    );
    el?.scrollIntoView?.({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [currentIndex, autoScroll, viewMode]);

  const renderSentence = (s: Sentence, extraClass = ""): ReactNode => {
    const isCurrent = s.index === currentIndex;
    let content: ReactNode = s.text;
    if (
      isCurrent &&
      wordHighlight &&
      wordRange &&
      wordRange.start >= s.start &&
      wordRange.end <= s.end &&
      wordRange.end > wordRange.start
    ) {
      const a = wordRange.start - s.start;
      const b = wordRange.end - s.start;
      content = (
        <>
          {s.text.slice(0, a)}
          <mark className="word-current">{s.text.slice(a, b)}</mark>
          {s.text.slice(b)}
        </>
      );
    }
    const classes = ["reader-sentence", extraClass];
    if (isCurrent && sentenceHighlight) classes.push("sentence-highlight");
    return (
      <span
        key={s.index}
        data-sentence-index={s.index}
        aria-current={isCurrent ? "true" : undefined}
        onClick={() => onActivate(s.index)}
        className={classes.filter(Boolean).join(" ")}
      >
        {content}
      </span>
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onActivate(currentIndex);
    }
  };

  let body: ReactNode;
  if (viewMode === "focus") {
    const current = sentences[currentIndex];
    const before = sentences[currentIndex - 1];
    const after = sentences[currentIndex + 1];
    body = (
      <div className="reader-focus mx-auto flex min-h-[50vh] max-w-5xl flex-col justify-center">
        {before && renderSentence(before, "focus-context")}
        {current && renderSentence(current, "focus-current")}
        {after && renderSentence(after, "focus-context")}
      </div>
    );
  } else {
    body = (
      <div className="reader-text">
        {paragraphs.map((p) => (
          <p key={p.index}>
            {p.sentences.map((s, i) => (
              <Fragment key={s.index}>
                {i > 0 && " "}
                {renderSentence(s)}
              </Fragment>
            ))}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="reader-root" data-view-mode={viewMode} style={readerStyle(settings)}>
      <section
        ref={containerRef}
        tabIndex={0}
        aria-label="Document text"
        onKeyDown={onKeyDown}
        className="rounded-xl p-2 sm:p-4"
      >
        {body}
      </section>
    </div>
  );
}
