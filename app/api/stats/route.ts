export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response("Invalid text body", { status: 400 });
  }

  if (raw === "") return new Response("Empty body", { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return new Response("Invalid request body", { status: 400 });
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return new Response("Invalid text field", { status: 400 });
  }

  if (text.length > 200_000) {
    return new Response("Text too long", { status: 413 });
  }

  const { countWords } = await import("@/lib/text/wordCount");
  const { splitSentences, splitParagraphs } = await import("@/lib/text/segment");

  const words = countWords(text);
  const sentences = splitSentences(text).length;
  const paragraphs = splitParagraphs(text).length;
  const minutes = Math.ceil(words / 200);

  return Response.json({ words, sentences, paragraphs, minutes });
}