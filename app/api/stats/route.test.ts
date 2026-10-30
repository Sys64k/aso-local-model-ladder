import { describe, expect, it, vi } from "vitest";
import { POST, runtime } from "./route";

function post(body: unknown, init: RequestInit = {}) {
  return new Request("http://localhost/api/stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

describe("POST /api/stats", () => {
  it("uses the nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns the four statistics for valid text", async () => {
    const text = "Hello world.\n\nThis is a test.\n\nAnother paragraph.";
    const res = await POST(post({ text }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      words: 8,
      sentences: 3,
      paragraphs: 3,
      minutes: 1,
    });
  });

  it("returns 400 for missing text", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for non-string text", async () => {
    const res = await POST(post({ text: 123 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for text set to null", async () => {
    const res = await POST(post({ text: null as unknown as string }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for text set to an object", async () => {
    const res = await POST(post({ text: { foo: "bar" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for empty text", async () => {
    const res = await POST(post({ text: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 400 for whitespace-only text", async () => {
    const res = await POST(post({ text: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("returns 413 for text over 200,000 characters", async () => {
    const text = "x".repeat(200_000);
    const res = await POST(post({ text }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("returns 413 for text exactly at the limit", async () => {
    const text = "x".repeat(200_000);
    const res = await POST(post({ text }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("returns 413 for text slightly over the limit", async () => {
    const text = "x".repeat(200_001);
    const res = await POST(post({ text }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("accurately counts words", async () => {
    const text = "Hello    world!\n\nThis    is\na test  with multiple   spaces.";
    const res = await POST(post({ text }));
    const body = await res.json();
    expect(body.words).toBe(9);
  });

  it("accurately counts sentences", async () => {
    const text = "Hello world. This is a test. Another sentence here!";
    const res = await POST(post({ text }));
    const body = await res.json();
    expect(body.sentences).toBe(3);
  });

  it("accurately counts paragraphs", async () => {
    const text = "First paragraph.\n\n\nSecond paragraph.";
    const res = await POST(post({ text }));
    const body = await res.json();
    expect(body.paragraphs).toBe(2);
  });

  it("accurately calculates minutes (rounded up)", async () => {
    // Using words that are separated by spaces
    const words = Array(200).fill("word"); // 200 words
    const text = words.join(" "); // joined by single spaces
    const res = await POST(post({ text }));
    const body = await res.json();
    expect(body.words).toBe(200);
    expect(body.minutes).toBe(1);

    const words2 = Array(201).fill("word"); // 201 words
    const text2 = words2.join(" ");
    const res2 = await POST(post({ text: text2 }));
    const body2 = await res2.json();
    expect(body2.words).toBe(201);
    expect(body2.minutes).toBe(2);

    const words3 = Array(400).fill("word"); // exactly 400 words
    const text3 = words3.join(" ");
    const res3 = await POST(post({ text: text3 }));
    const body3 = await res3.json();
    expect(body3.words).toBe(400);
    expect(body3.minutes).toBe(2);

    const words4 = Array(401).fill("word"); // slightly over 2 minutes
    const text4 = words4.join(" ");
    const res4 = await POST(post({ text: text4 }));
    const body4 = await res4.json();
    expect(body4.words).toBe(401);
    expect(body4.minutes).toBe(3);
  });
});