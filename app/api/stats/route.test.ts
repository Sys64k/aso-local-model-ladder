// @vitest-environment node
import { describe, expect, it } from "vitest";
import { splitParagraphs, splitSentences } from "@/lib/text/segment";
import { POST } from "./route";

const MAX_CHARS = 200_000;

function post(body: unknown, init: RequestInit = {}) {
  return new Request("http://localhost/api/stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

async function stats(text: string) {
  const res = await POST(post({ text }));
  expect(res.status).toBe(200);
  return res.json();
}

function words(n: number) {
  return Array.from({ length: n }, () => "word").join(" ");
}

describe("POST /api/stats", () => {
  it("answers words, sentences, paragraphs and minutes for valid text", async () => {
    const text = "First sentence. Second one!\n\nA new paragraph here?";
    const res = await POST(post({ text }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ words: 8, sentences: 3, paragraphs: 2, minutes: 1 });
  });

  it("counts sentences and paragraphs with lib/text/segment", async () => {
    const text =
      "Dr. Smith arrived at 3.14 pm. He said hello!\n\nWait... what? Nobody knew.\n\n\n  Last paragraph.  ";
    const body = await stats(text);
    expect(body.sentences).toBe(splitSentences(text).length);
    expect(body.paragraphs).toBe(splitParagraphs(text).length);
    expect(body.paragraphs).toBe(3);
  });

  it("ignores extra whitespace when counting", async () => {
    expect(await stats("  Hello   world.  \n\n\n  Bye.  ")).toEqual({
      words: 3,
      sentences: 2,
      paragraphs: 2,
      minutes: 1,
    });
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "   \n\n \t  \n"],
  ])("answers zeros for %s text", async (_label, text) => {
    expect(await stats(text)).toEqual({ words: 0, sentences: 0, paragraphs: 0, minutes: 0 });
  });

  it.each([
    [1, 1],
    [199, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [401, 3],
  ])("reads %i words in %i minute(s) at 200 words a minute, rounded up", async (n, minutes) => {
    const body = await stats(words(n));
    expect(body.words).toBe(n);
    expect(body.minutes).toBe(minutes);
  });

  it.each([
    ["missing text", {}],
    ["numeric text", { text: 42 }],
    ["null text", { text: null }],
    ["array text", { text: ["a", "b"] }],
    ["object text", { text: { value: "hi" } }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON string", JSON.stringify("just text")],
    ["JSON null", "null"],
    ["an empty body", ""],
  ])("returns 400 for %s", async (_label, raw) => {
    const res = await POST(post(raw));
    expect(res.status).toBe(400);
  });

  it(`accepts text of exactly ${MAX_CHARS} characters`, async () => {
    const body = await stats("a".repeat(MAX_CHARS));
    expect(body).toEqual({ words: 1, sentences: 1, paragraphs: 1, minutes: 1 });
  });

  it(`returns 413 for text over ${MAX_CHARS} characters`, async () => {
    const res = await POST(post({ text: "a".repeat(MAX_CHARS + 1) }));
    expect(res.status).toBe(413);
  });

  it("limits characters, not bytes", async () => {
    // 200 000 two-byte characters is 400 000 bytes of UTF-8 but still within the limit.
    const body = await stats("é".repeat(MAX_CHARS));
    expect(body.words).toBe(1);
  });

  it("counts many words in long text", async () => {
    const text = "word ".repeat(MAX_CHARS / 5).trim();
    const body = await stats(text);
    expect(body.words).toBe(MAX_CHARS / 5);
    expect(body.minutes).toBe(MAX_CHARS / 5 / 200);
  });
});
