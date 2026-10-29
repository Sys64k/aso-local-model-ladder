/**
 * Text normalisation and sentence/paragraph segmentation.
 *
 * All offsets are character (UTF-16 code unit) offsets into the text passed
 * in; `end` is exclusive. For every sentence,
 * `text.slice(start, end).trim() === sentence.text` holds (in fact the slice
 * is already trimmed).
 */

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
}

export interface Paragraph {
  index: number;
  start: number;
  end: number;
  sentences: Sentence[];
}

export interface SegmentOptions {
  /** Force (true) or disable (false) Intl.Segmenter. Default: use it when available. */
  segmenter?: boolean;
}

// Control characters except \t \n \r (those are handled separately).
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;

/**
 * Clean up pasted / OCR / PDF text:
 * - CRLF and lone CR become LF
 * - control characters are removed (tabs, form/vertical feeds become spaces)
 * - words hyphenated across a line break are joined (`exam-\nple` → `example`)
 * - 2+ newlines become a paragraph break (`\n\n`)
 * - single line breaks inside a paragraph become spaces
 * - runs of spaces are collapsed and the result is trimmed
 */
export function normalizeText(raw: string): string {
  if (!raw) return "";
  let t = String(raw).replace(/\r\n?/g, "\n");
  t = t.replace(/[\t\v\f\u00A0]/g, " ");
  t = t.replace(CONTROL_CHARS, "");
  // Trim spaces around line breaks so "  \n  \n" counts as a paragraph break.
  t = t.replace(/ *\n */g, "\n");
  // Hyphenated line breaks: drop the hyphen before a lowercase continuation,
  // keep it (without the break) before an uppercase one ("Anglo-\nSaxon").
  t = t.replace(/(\p{L})[-\u00AD\u2010]\n(?=\p{Ll})/gu, "$1");
  t = t.replace(/(\p{L})[-\u2010]\n(?=\p{Lu})/gu, "$1-");
  return t
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/ {2,}/g, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

interface Span {
  start: number;
  end: number;
}

type SentenceSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

let cachedSegmenter: SentenceSegmenter | null | undefined;

function getSegmenter(): SentenceSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  cachedSegmenter = null;
  try {
    const Seg = (
      globalThis as {
        Intl?: {
          Segmenter?: new (
            locale?: string,
            opts?: { granularity: string },
          ) => SentenceSegmenter;
        };
      }
    ).Intl?.Segmenter;
    if (typeof Seg === "function") {
      cachedSegmenter = new Seg(undefined, { granularity: "sentence" });
    }
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Raw sentence spans with Intl.Segmenter. */
function segmentWithIntl(block: string, segmenter: SentenceSegmenter): Span[] {
  const spans: Span[] = [];
  for (const s of segmenter.segment(block)) {
    spans.push({ start: s.index, end: s.index + s.segment.length });
  }
  return spans;
}

// Sentence terminator (+ closing quotes/brackets) followed by whitespace or
// end of input, or a hard line break.
const TERMINATOR = /[.!?\u2026]+["'\u201D\u2019\u00BB)\]]*(?=\s|$)|\n/g;

/** Raw sentence spans with a regex (fallback for engines without Intl.Segmenter). */
function segmentWithRegex(block: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  TERMINATOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TERMINATOR.exec(block)) !== null) {
    const end = m.index + m[0].length;
    if (end > last) {
      spans.push({ start: last, end });
      last = end;
    }
    if (m[0].length === 0) TERMINATOR.lastIndex++;
  }
  if (last < block.length) spans.push({ start: last, end: block.length });
  return spans;
}

const ABBREVIATION =
  /(?:^|[^\p{L}\p{N}.])(?:mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|e\.g|i\.e)\.["'\u201D\u2019)\]]*$/iu;

/** Should the break between `prev` and `next` be suppressed? */
function shouldJoin(prev: string, next: string): boolean {
  const p = prev.trimEnd();
  const n = next.trimStart();
  if (!p || !n) return true; // whitespace-only pieces stick to the previous one
  if (ABBREVIATION.test(p)) return true;
  // Decimal number split in the middle: "3." + "14 ..."
  if (/\d\.$/.test(prev) && /^\d/.test(next)) return true;
  // A sentence never starts with a lowercase letter ("Wait... what", "e.g. this",
  // or a stray single line break in the middle of a sentence).
  if (/^\p{Ll}/u.test(n)) return true;
  return false;
}

function segmentBlock(block: string, options?: SegmentOptions): Span[] {
  const useIntl = options?.segmenter ?? true;
  const segmenter = useIntl ? getSegmenter() : null;
  const raw = segmenter
    ? segmentWithIntl(block, segmenter)
    : segmentWithRegex(block);
  const merged: Span[] = [];
  for (const span of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      shouldJoin(
        block.slice(prev.start, prev.end),
        block.slice(span.start, span.end),
      )
    ) {
      prev.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

// Paragraph break: two line breaks with only (non-newline) whitespace in between.
const PARAGRAPH_BREAK = /\n[^\S\n]*\n\s*/g;

/** Split text into paragraphs (at 2+ line breaks) and sentences. Sentence indexes are global. */
export function splitParagraphs(
  text: string,
  options?: SegmentOptions,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  if (!text) return paragraphs;
  let sentenceIndex = 0;

  const blocks: Span[] = [];
  let last = 0;
  PARAGRAPH_BREAK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAGRAPH_BREAK.exec(text)) !== null) {
    blocks.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  blocks.push({ start: last, end: text.length });

  for (const b of blocks) {
    const blockText = text.slice(b.start, b.end);
    const trimmedStart = blockText.length - blockText.trimStart().length;
    const trimmed = blockText.trim();
    if (!trimmed) continue;
    const sentences: Sentence[] = [];
    for (const span of segmentBlock(blockText, options)) {
      const piece = blockText.slice(span.start, span.end);
      const sentenceText = piece.trim();
      if (!sentenceText) continue;
      const lead = piece.length - piece.trimStart().length;
      const start = b.start + span.start + lead;
      sentences.push({
        index: sentenceIndex++,
        text: sentenceText,
        start,
        end: start + sentenceText.length,
      });
    }
    const start = b.start + trimmedStart;
    paragraphs.push({
      index: paragraphs.length,
      start,
      end: start + trimmed.length,
      sentences,
    });
  }
  return paragraphs;
}

/** Split text into sentences. Paragraph breaks always end a sentence. */
export function splitSentences(
  text: string,
  options?: SegmentOptions,
): Sentence[] {
  return splitParagraphs(text, options).flatMap((p) => p.sentences);
}
