import { splitParagraphs, splitSentences } from "@/lib/text/segment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.bodyUsed) {
    return new Response("Request body already read", { status: 400 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("application/json")) {
    return new Response("Content-Type must be application/json", { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return new Response("Missing text", { status: 400 });
  }

  const { text } = body as { text?: unknown };
  if (text === undefined) {
    return new Response("Missing text", { status: 400 });
  }
  if (typeof text !== "string") {
    return new Response("Text must be a string", { status: 400 });
  }

  if (text.length > 200_000) {
    return new Response("Text too long", { status: 413 });
  }

  // Count words by splitting on whitespace and filtering empty strings
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  // Count sentences using the splitSentences utility
  const sentences = splitSentences(text).length;
  
  // Count paragraphs by splitting on double newlines or using the splitParagraphs utility
  const paragraphs = splitParagraphs(text).length;

  // Calculate reading time (rounded up at 200 words per minute)
  const minutes = Math.ceil(words / 200);

  return Response.json({ words, sentences, paragraphs, minutes });
}