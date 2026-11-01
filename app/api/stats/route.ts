import { NextResponse } from "next/server";
import { splitParagraphs, splitSentences } from "@/lib/text/segment";
import { countWords } from "@/lib/text/wordCount";

const MAX_CHARS = 200_000;

export async function POST(request: Request) {
  // Check if content type is JSON
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return new Response("Content-Type must be application/json", { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Validate text field
  if (body === null || body === undefined || typeof body !== "object" || !("text" in body)) {
    return new Response("Missing text field", { status: 400 });
  }

  const text = body.text;
  
  // Check that text is a string
  if (typeof text !== "string") {
    return new Response("Text must be a string", { status: 400 });
  }

  // Check length limit
  if (text.length > MAX_CHARS) {
    return new Response("Text too long", { status: 413 });
  }

  // Normalize text for counting but keep original for display purposes
  const normalizedText = text.trim();
  
  // Special case: empty or whitespace-only text
  if (!normalizedText) {
    return NextResponse.json({
      words: 0,
      sentences: 0,
      paragraphs: 0,
      minutes: 0,
    });
  }

  // Count sentences and paragraphs
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  
  // Count words
  const words = countWords(text);

  // Calculate minutes (200 words per minute, rounded up)
  const minutes = Math.ceil(words / 200);

  return NextResponse.json({
    words,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    minutes,
  });
}