import { splitParagraphs, splitSentences } from "@/lib/text/segment";

export const runtime = "nodejs";

const MAX_CHARACTERS = 200_000;

const STATUS_CODES: Record<string, number> = {
  bad_request: 400,
  payload_too_large: 413,
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(code: string): Response {
  return json({ error: code }, STATUS_CODES[code] || 400);
}

export async function POST(request: Request): Promise<Response> {
  let raw: string | null;
  try {
    raw = await request.text();
  } catch {
    return errorResponse("bad_request");
  }

  if (!raw) return errorResponse("bad_request");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse("bad_request");
  }

  if (typeof body !== "object" || body === null) return errorResponse("bad_request");

  const text = (body as { text?: unknown }).text;

  // Missing or non-string text gives 400
  if (typeof text !== "string") return errorResponse("bad_request");

  // Check for empty or whitespace-only text (after trimming)
  const trimmed = text.trim();
  if (!trimmed) return errorResponse("bad_request");

  // Too long gives 413
  if (text.length >= MAX_CHARACTERS) return errorResponse("payload_too_large");

  // Count words: split by whitespace and filter empty strings
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0).length;

  // Get paragraph and sentence counts from the segment functions
  const paragraphs = splitParagraphs(text);
  const sentences = splitSentences(text);

  const minutes = Math.ceil(words / 200);

  return json(
    {
      words,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      minutes,
    },
    200,
  );
}