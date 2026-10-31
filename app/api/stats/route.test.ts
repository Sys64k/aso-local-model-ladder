// @vitest-environment node
import { describe, expect, it } from "vitest";
import { splitParagraphs, splitSentences } from "@/lib/text/segment";
import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function words(n: number) {
  return Array.from({ length: n }, () => "word").join(" ");
}

const SAMPLE = "The quick brown fox jumps. It runs away!\n\nA second paragraph here.";

describe("POST /api/stats", () => {
  it("answers words, sentences, paragraphs and minutes for valid text", async () => {
    // Preconditions: the segmenter agrees with the expected numbers.
    expect(splitSentences(SAMPLE)).toHaveLength(3);
    expect(splitParagraphs(SAMPLE)).toHaveLength(2);

    const res = await POST(post({ text: SAMPLE }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ words: 12, sentences: 3, paragraphs: 2, minutes: 1 });
  });

  it("counts sentences with splitSentences (abbreviations and decimals are not breaks)", async () => {
    const text = "Dr. Smith met Mr. Jones at 3.14 pm. They talked.";
    expect(splitSentences(text)).toHaveLength(2);
    const res = await POST(post({ text }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sentences).toBe(2);
    expect(body.paragraphs).toBe(1);
  });

  it("counts paragraphs with splitParagraphs", async () => {
    const text = "One.\n\nTwo.\n  \nThree.\n\n\n\nFour.";
    expect(splitParagraphs(text)).toHaveLength(4);
    const res = await POST(post({ text }));
    const body = await res.json();
    expect(body.paragraphs).toBe(4);
    expect(body.sentences).toBe(4);
    expect(body.words).toBe(4);
  });

  it.each([
    [1, 1],
    [199, 1],
    [200, 1],
    [201, 2],
    [400, 2],
    [401, 3],
  ])("%i words take %i minute(s) at 200 words a minute, rounded up", async (n, minutes) => {
    const res = await POST(post({ text: words(n) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.words).toBe(n);
    expect(body.minutes).toBe(minutes);
  });

  it("answers zeros for empty text", async () => {
    const res = await POST(post({ text: "" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: 0, sentences: 0, paragraphs: 0, minutes: 0 });
  });

  it("answers zeros for whitespace-only text", async () => {
    const res = await POST(post({ text: "   \n\n \t  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: 0, sentences: 0, paragraphs: 0, minutes: 0 });
  });

  it.each([
    ["missing text", {}],
    ["numeric text", { text: 42 }],
    ["null text", { text: null }],
    ["array text", { text: ["a", "b"] }],
    ["object text", { text: { value: "hello" } }],
    ["a JSON string body", "\"just a string\""],
    ["a JSON null body", "null"],
    ["a JSON array body", "[\"text\"]"],
    ["malformed JSON", "{not json"],
    ["an empty body", ""],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
  });

  it("accepts text of exactly 200 000 characters", async () => {
    const res = await POST(post({ text: "a".repeat(200_000) }));
    expect(res.status).toBe(200);
    expect((await res.json()).words).toBe(1);
  });

  it("limits characters, not bytes: 200 000 two-byte characters are accepted", async () => {
    const res = await POST(post({ text: "é".repeat(200_000) }));
    expect(res.status).toBe(200);
  });

  it("returns 413 for text of 200 001 characters", async () => {
    const res = await POST(post({ text: "a".repeat(200_001) }));
    expect(res.status).toBe(413);
  });

  it("returns 413 for much longer text", async () => {
    const res = await POST(post({ text: words(100_000) }));
    expect(res.status).toBe(413);
  });
});
