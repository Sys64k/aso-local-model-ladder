// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/extract")>();
  return {
    ...actual,
    fetchHtml: vi.fn(actual.fetchHtml),
    extractReadable: vi.fn(actual.extractReadable),
  };
});

// DNS must never hit the network in tests.
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async (hostname: string) => {
    if (hostname === "intranet.example") return [{ address: "10.0.0.7", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  });
  return { lookup, default: { lookup } };
});

import { ExtractError, extractReadable, fetchHtml } from "@/lib/server/extract";
import { POST, runtime } from "./route";

const ARTICLE_HTML = readFileSync(
  join(__dirname, "../../../tests/fixtures/article.html"),
  "utf8",
);

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(fetchHtml).mockClear();
  vi.mocked(extractReadable).mockClear();
});

function post(body: unknown, init: RequestInit = {}) {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

describe("POST /api/extract", () => {
  it("uses the nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns the article for an HTML page", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(ARTICLE_HTML));
    const res = await POST(post({ url: "https://example.com/listening" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["byline", "siteName", "text", "title", "url"]);
    expect(body.title).toMatch(/The Quiet Art of Listening/);
    expect(body.siteName).toBe("Example Times");
    expect(body.url).toBe("https://example.com/listening");
    expect(body.text).toContain("\n\n");
    expect(body.text).not.toMatch(/<[a-z/]/i);
    expect(body.text.split("\n\n")).toContain("Why it matters");
  });

  it("reports the final URL after redirects", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://www.example.com/a" } }),
      )
      .mockResolvedValueOnce(htmlResponse(ARTICLE_HTML));
    const res = await POST(post({ url: "http://example.com/a" }));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://www.example.com/a");
  });

  it.each([
    ["missing url", {}],
    ["non-string url", { url: 42 }],
    ["empty url", { url: "  " }],
    ["unparsable url", { url: "not a url" }],
    ["ftp url", { url: "ftp://example.com/file" }],
    ["javascript url", { url: "javascript:alert(1)" }],
  ])("returns 400 invalid_url for %s", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_url for malformed JSON", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_url" });
  });

  it("rejects request bodies over 10 KB", async () => {
    const res = await POST(post({ url: "https://example.com/?q=" + "a".repeat(11 * 1024) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.0.1/",
    "http://intranet.example/",
  ])("returns 403 blocked_host for %s", async (url) => {
    const res = await POST(post({ url }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "blocked_host" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 blocked_host for a redirect to a private host", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.1/admin" } }),
    );
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "blocked_host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 413 too_large for oversized pages", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<p>x</p>", { headers: { "content-length": String(6 * 1024 * 1024) } }),
    );
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_large" });
  });

  it("returns 415 unsupported_content for non-HTML", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const res = await POST(post({ url: "https://example.com/doc.pdf" }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_content" });
  });

  it("returns 422 no_content when nothing readable is found", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse("<html><body><p>Hi</p></body></html>"));
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_content" });
  });

  it("returns 502 fetch_failed for upstream errors", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse("gone", { status: 404 }));
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fetch_failed" });
  });

  it("returns 502 fetch_failed for network errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fetch_failed" });
  });

  it.each([
    ["invalid_url", 400],
    ["blocked_host", 403],
    ["too_large", 413],
    ["unsupported_content", 415],
    ["no_content", 422],
    ["fetch_failed", 502],
  ] as const)("maps ExtractError %s to %i", async (code, status) => {
    vi.mocked(fetchHtml).mockRejectedValueOnce(new ExtractError(code));
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: code });
  });

  it("maps unexpected errors to 502 fetch_failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchHtml).mockResolvedValueOnce({ html: "<p>x</p>", finalUrl: "https://example.com/" });
    vi.mocked(extractReadable).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await POST(post({ url: "https://example.com/" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fetch_failed" });
    spy.mockRestore();
  });
});
