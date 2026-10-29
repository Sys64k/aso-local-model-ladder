// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("returns words, sentences, paragraphs and minutes for valid text", async () => {
    const res = await POST(post({ text: "Hello world. This is a test." }));
    
    expect(res.status).toBe(200);
    // Note: Node.js Response returns just "application/json" without charset
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await res.json();
    expect(body).toEqual({
      words: 6,
      sentences: 2,
      paragraphs: 1,
      minutes: 1,
    });
  });

  it("handles empty text correctly", async () => {
    const res = await POST(post({ text: "" }));
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      words: 0,
      sentences: 0,
      paragraphs: 0,
      minutes: 0,
    });
  });

  it("handles whitespace-only text correctly", async () => {
    const res = await POST(post({ text: "   \n  \t  " }));
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      words: 0,
      sentences: 0,
      paragraphs: 0,
      minutes: 0,
    });
  });

  it("counts words correctly", async () => {
    const res = await POST(post({ text: "  Hello   world.   This\tis\na test.  " }));
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.words).toBe(6);
  });

  it("counts sentences correctly", async () => {
    const res = await POST(post({ text: "Hello world. This is a test! And another sentence? Yes." }));
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sentences).toBe(4);
  });

  it("counts paragraphs correctly", async () => {
    const res = await POST(post({ text: "First paragraph.\n\nSecond paragraph. \n\n\nThird paragraph." }));
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paragraphs).toBe(3);
  });

  it("calculates reading time correctly (rounded up)", async () => {
    // 1 word -> 1 minute
    let res = await POST(post({ text: "word" }));
    expect((await res.json()).minutes).toBe(1);
    
    // 200 words -> 1 minute
    res = await POST(post({ text: "a ".repeat(200) }));
    expect((await res.json()).minutes).toBe(1);
    
    // 201 words -> 2 minutes  
    res = await POST(post({ text: "a ".repeat(201) }));
    expect((await res.json()).minutes).toBe(2);
  });

  it("returns 400 for missing text", async () => {
    const res = await POST(post({}));
    
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Missing text");
  });

  it("returns 400 for non-string text", async () => {
    const res = await POST(post({ text: 42 }));
    
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Text must be a string");
  });

  it("returns 413 for text over 200,000 characters", async () => {
    const res = await POST(post({ text: "a".repeat(200_001) }));
    
    expect(res.status).toBe(413);
    expect(await res.text()).toBe("Text too long");
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost/api/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    
    const res = await POST(req);
    
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid JSON");
  });

  it("returns 400 for wrong content type", async () => {
    const req = new Request("http://localhost/api/stats", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ text: "test" }),
    });
    
    const res = await POST(req);
    
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Content-Type must be application/json");
  });
});