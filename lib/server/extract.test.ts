// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl,
  DEFAULT_MAX_BYTES,
  ExtractError,
  extractReadable,
  fetchHtml,
  isPrivateAddress,
  type LookupFn,
  stripNonContent,
} from "./extract";

const ARTICLE_HTML = readFileSync(
  join(__dirname, "../../tests/fixtures/article.html"),
  "utf8",
);

const WIKIPEDIA_HTML = readFileSync(
  join(__dirname, "../../tests/fixtures/wikipedia-article.html"),
  "utf8",
);

const PUBLIC_IP = "93.184.216.34";

/** DNS mock: hosts map to addresses; unknown hosts resolve to a public IP. */
function mockLookup(table: Record<string, string[]> = {}) {
  return vi.fn<LookupFn>(async (hostname) => {
    const addrs = table[hostname] ?? [PUBLIC_IP];
    return addrs.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  });
}

function htmlResponse(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ExtractError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("isPrivateAddress", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "127.10.20.30",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    PUBLIC_IP,
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.1.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:82a::200e",
    "::ffff:8.8.8.8",
  ])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("accepts a public host", async () => {
    const lookup = mockLookup();
    await expect(assertPublicUrl(new URL("https://example.com/a"), lookup)).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects non-http protocols", async () => {
    await expectCode(assertPublicUrl(new URL("ftp://example.com/"), mockLookup()), "invalid_url");
    await expectCode(assertPublicUrl(new URL("file:///etc/passwd"), mockLookup()), "invalid_url");
  });

  it.each([
    "http://localhost/",
    "http://localhost.:3000/",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://0x7f.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:192.168.0.1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://10.1.2.3:8080/",
  ])("blocks %s without needing DNS", async (url) => {
    const lookup = mockLookup();
    await expectCode(assertPublicUrl(new URL(url), lookup), "blocked_host");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks hosts that resolve to a private address", async () => {
    const lookup = mockLookup({ "internal.example": ["192.168.0.10"] });
    await expectCode(assertPublicUrl(new URL("http://internal.example/"), lookup), "blocked_host");
  });

  it("blocks when any resolved address is private", async () => {
    const lookup = mockLookup({ "mixed.example": [PUBLIC_IP, "fe80::1"] });
    await expectCode(assertPublicUrl(new URL("http://mixed.example/"), lookup), "blocked_host");
  });

  it("maps DNS failures to fetch_failed", async () => {
    const lookup = vi.fn<LookupFn>(async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await expectCode(assertPublicUrl(new URL("http://nope.example/"), lookup), "fetch_failed");
  });
});

describe("fetchHtml", () => {
  it("returns html and final URL, sending a bot User-Agent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(ARTICLE_HTML));
    const result = await fetchHtml("https://example.com/post", {
      fetchImpl,
      lookup: mockLookup(),
    });
    expect(result.html).toContain("The Quiet Art of Listening");
    expect(result.finalUrl).toBe("https://example.com/post");

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("user-agent")).toMatch(/ReadAloudBot\/1\.0/);
  });

  it("follows redirects manually and reports the final URL", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect("https://www.example.com/post", 301))
      .mockResolvedValueOnce(redirect("/post/final"))
      .mockResolvedValueOnce(htmlResponse(ARTICLE_HTML));
    const lookup = mockLookup();
    const result = await fetchHtml("http://example.com/post", { fetchImpl, lookup });
    expect(result.finalUrl).toBe("https://www.example.com/post/final");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(lookup.mock.calls.map((c) => c[0])).toEqual([
      "example.com",
      "www.example.com",
      "www.example.com",
    ]);
  });

  it("blocks a redirect to a private IP literal", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data"));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "blocked_host",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a host resolving to a private address", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect("http://intranet.example/admin"));
    const lookup = mockLookup({ "intranet.example": ["10.0.0.5"] });
    await expectCode(fetchHtml("https://example.com/", { fetchImpl, lookup }), "blocked_host");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to localhost", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(redirect("http://localhost:3000/"));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "blocked_host",
    );
  });

  it("blocks the initial request to a private host without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expectCode(
      fetchHtml("http://192.168.1.1/", { fetchImpl, lookup: mockLookup() }),
      "blocked_host",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up after 5 redirects", async () => {
    let n = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => redirect(`https://example.com/r${++n}`));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "fetch_failed",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("allows exactly 5 redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (let i = 1; i <= 5; i++) fetchImpl.mockResolvedValueOnce(redirect(`/r${i}`));
    fetchImpl.mockResolvedValueOnce(htmlResponse("<p>ok</p>"));
    const result = await fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() });
    expect(result.finalUrl).toBe("https://example.com/r5");
  });

  it("rejects bodies whose Content-Length exceeds the cap", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      htmlResponse("<p>small</p>", {
        headers: { "content-length": String(DEFAULT_MAX_BYTES + 1) },
      }),
    );
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "too_large",
    );
  });

  it("enforces the 5 MB default cap while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) {
          controller.close();
          return;
        }
        sent++;
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(stream));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "too_large",
    );
    // stopped reading shortly after crossing 5 MB, not the full 10 MB
    expect(sent).toBeLessThanOrEqual(7);
  });

  it("respects a custom maxBytes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse("x".repeat(2000)));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup(), maxBytes: 1000 }),
      "too_large",
    );
  });

  it("times out using AbortController", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const started = Date.now();
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup(), timeoutMs: 30 }),
      "fetch_failed",
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("uses a 10 s default timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchImpl = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const promise = fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(9_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await expectCode(promise, "fetch_failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out while the body is still streaming", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<p>partial"));
      },
    });
    // The stream never closes; only the timeout can end the read.
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse(stream));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup(), timeoutMs: 30 }),
      "fetch_failed",
    );
  });

  it.each(["application/json", "application/pdf", "image/png", "text/plain"])(
    "rejects %s as unsupported_content",
    async (type) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () => new Response("data", { status: 200, headers: { "content-type": type } }),
      );
      await expectCode(
        fetchHtml("https://example.com/file", { fetchImpl, lookup: mockLookup() }),
        "unsupported_content",
      );
    },
  );

  it("accepts application/xhtml+xml", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("<html/>", {
          status: 200,
          headers: { "content-type": "application/xhtml+xml; charset=utf-8" },
        }),
    );
    await expect(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
    ).resolves.toMatchObject({ html: "<html/>" });
  });

  it("rejects a missing content-type", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const res = new Response(new Uint8Array([60, 112, 62]), { status: 200 });
      res.headers.delete("content-type");
      return res;
    });
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "unsupported_content",
    );
  });

  it.each([404, 500, 503])("maps upstream status %i to fetch_failed", async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => htmlResponse("nope", { status }));
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "fetch_failed",
    );
  });

  it("maps network errors to fetch_failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expectCode(
      fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() }),
      "fetch_failed",
    );
  });

  it("rejects invalid URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expectCode(fetchHtml("not a url", { fetchImpl, lookup: mockLookup() }), "invalid_url");
    await expectCode(
      fetchHtml("javascript:alert(1)", { fetchImpl, lookup: mockLookup() }),
      "invalid_url",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("decodes the declared charset", async () => {
    const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "text/html; charset=ISO-8859-1" },
        }),
    );
    const { html } = await fetchHtml("https://example.com/", { fetchImpl, lookup: mockLookup() });
    expect(html).toBe("<p>café</p>");
  });
});

describe("extractReadable", () => {
  it("extracts title, byline, site name and paragraph text from the fixture", () => {
    const result = extractReadable(ARTICLE_HTML, "https://example.com/listening");
    expect(result.title).toMatch(/The Quiet Art of Listening/);
    expect(result.siteName).toBe("Example Times");
    expect(result.byline).toMatch(/Jane Doe/);

    const paragraphs = result.text.split("\n\n");
    expect(paragraphs.length).toBeGreaterThanOrEqual(8);
    expect(result.text).toContain(
      "Yet true listening — the kind that changes how we understand one another — requires patience & practice.",
    );
    expect(paragraphs).toContain("Why it matters");
    expect(paragraphs).toContain("Put away your phone during conversations.");
    expect(paragraphs).toContain("Ask open questions and wait for the answer.");
    expect(paragraphs).toContain(
      "“The most basic of all human needs is the need to understand and be understood.”",
    );
  });

  it("produces plain text without HTML, scripts, or navigation", () => {
    const { text } = extractReadable(ARTICLE_HTML, "https://example.com/listening");
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).not.toMatch(/&[a-z]+;/i);
    expect(text).not.toContain("analytics");
    expect(text).not.toContain("font-family");
    expect(text).not.toContain("Subscribe");
    // whitespace inside paragraphs is collapsed
    for (const p of text.split("\n\n")) {
      expect(p).toBe(p.trim());
      expect(p).not.toMatch(/\s{2,}|\n/);
    }
  });

  it("falls back to document.title when Readability has no title", () => {
    const body = "<p>" + "Plenty of readable words in this paragraph. ".repeat(20) + "</p>";
    const html = `<html><head><title>Fallback Title</title></head><body><article>${body}${body}</article></body></html>`;
    const result = extractReadable(html, "https://example.com/");
    expect(result.title).toBe("Fallback Title");
    expect(result.byline).toBeNull();
    expect(result.siteName).toBeNull();
  });

  it("throws no_content for an empty page", () => {
    expect(() => extractReadable("<html><body></body></html>", "https://example.com/")).toThrow(
      expect.objectContaining({ code: "no_content" }),
    );
  });

  it("throws no_content when the text is shorter than 50 characters", () => {
    const html = "<html><head><title>T</title></head><body><article><p>Too short.</p></article></body></html>";
    expect(() => extractReadable(html, "https://example.com/")).toThrow(
      expect.objectContaining({ code: "no_content" }),
    );
  });
});

describe("extractReadable on a Wikipedia article", () => {
  const WIKI_URL = "https://en.wikipedia.org/wiki/Lighthouse_keeper";

  it("keeps the title and all prose paragraphs without citation markers", () => {
    const result = extractReadable(WIKIPEDIA_HTML, WIKI_URL);
    expect(result.title).toMatch(/Lighthouse keeper/);

    const paragraphs = result.text.split("\n\n");
    expect(paragraphs).toContain(
      "A lighthouse keeper or lightkeeper is the person responsible for tending and caring for a lighthouse, particularly the light and lens in the days when oil lamps and clockwork mechanisms were used. Lighthouse keepers were sometimes referred to as \"wickies\" because of their job trimming the wicks.",
    );
    expect(paragraphs).toContain(
      "Keepers were needed to trim wicks, replenish fuel, wind clockworks and perform maintenance tasks such as cleaning lenses and windows. Remote lighthouses were often staffed by several keepers who worked in shifts through the night.",
    );
    expect(result.text).toContain("The earliest keepers tended open coal fires");
    expect(paragraphs).toContain(
      "By the nineteenth century, keepers were usually employed by national lighthouse authorities, which issued strict rules about logbooks, uniforms and the hours at which the light had to be lit. Families often lived at the station and shared the work.",
    );
    expect(result.text).toContain("Electrification and automatic lamp changers");
    expect(result.text).toContain("A keeper's routine typically included lighting the lamp");
    expect(result.text).toContain("In emergencies, keepers also took part in rescues");
    expect(paragraphs).toContain("Sounding the fog signal whenever visibility dropped.");
  });

  it("drops infobox, tables, navigation, references and back matter", () => {
    const { text } = extractReadable(WIKIPEDIA_HTML, WIKI_URL);
    for (const unwanted of [
      "Infobox-Only-Value",
      "Occupation type",
      "Hatnote-Only-Novel",
      "Wikitable-Cell-Alpha",
      "Wikitable-Cell-Year",
      "Last staffed stations",
      "Navbox-Lighthouses-Title",
      "Navbox-Lightvessel-Link",
      "Jump to content",
      "Main menu",
      "[edit]",
      "TocEntry-",
      "Contents",
      "[citation needed]",
      "citation needed",
      "Reflist-Entry-Lighthouse-Service",
      "Keepers of the Light",
      "See also",
      "SeeAlso-Lightvessel-Entry",
      "External links",
      "ExternalLink-Lighthouse-Society",
      "Category-Lighthouse-Occupations",
      "Category-Maritime-Occupations",
      "Retrieved from",
    ]) {
      expect(text, unwanted).not.toContain(unwanted);
    }
    expect(text).not.toMatch(/\[\d+\]/);
    expect(text).not.toMatch(/\bReferences\b/);
    expect(text).not.toMatch(/\bedit\b/);
    expect(text).not.toContain("^");
  });
});

describe("stripNonContent", () => {
  function body(html: string): HTMLElement {
    return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document.body;
  }

  it("removes tables, nav, infoboxes and reference lists", () => {
    const root = body(`
      <nav><a href="/">Home</a></nav>
      <div class="infobox">Infobox text</div>
      <table><tr><td>Data cell</td></tr></table>
      <p>Prose<sup class="reference"><a href="#n1">[1]</a></sup> stays.</p>
      <ol class="references"><li>Reference entry</li></ol>
    `);
    stripNonContent(root);
    expect(root.querySelector("nav, table, .infobox, ol, sup")).toBeNull();
    expect(root.textContent).not.toMatch(/Home|Infobox text|Data cell|Reference entry|\[1\]/);
    expect(root.querySelector("p")?.textContent).toBe("Prose stays.");
  });

  it("removes a References section up to the next h2 and keeps that section", () => {
    const root = body(`
      <h2>Intro</h2>
      <p>Intro prose.</p>
      <h2>References <span class="mw-editsection">[edit]</span></h2>
      <p>Smith 1999.</p>
      <h3>Primary sources</h3>
      <ul><li>Archive entry</li></ul>
      <h2>Legacy</h2>
      <p>Legacy prose.</p>
    `);
    stripNonContent(root);
    const text = root.textContent ?? "";
    expect(text).not.toMatch(/References|Smith 1999|Primary sources|Archive entry|\[edit\]/);
    expect(text).toContain("Intro prose.");
    expect(Array.from(root.querySelectorAll("h2")).map((h) => h.textContent)).toEqual([
      "Intro",
      "Legacy",
    ]);
    expect(text).toContain("Legacy prose.");
  });

  it("handles mw-heading wrappers and a trailing [edit] in the heading text", () => {
    const root = body(`
      <div class="mw-heading mw-heading2"><h2>Body</h2></div>
      <p>Body prose.</p>
      <div class="mw-heading mw-heading2"><h2>See also [edit]</h2></div>
      <ul><li>Related topic</li></ul>
      <div class="mw-heading mw-heading3"><h3>More</h3></div>
      <p>Nested back matter.</p>
      <div class="mw-heading mw-heading2"><h2>Further Reading</h2></div>
      <ul><li>Some book</li></ul>
    `);
    stripNonContent(root);
    const text = root.textContent ?? "";
    expect(text).toContain("Body prose.");
    expect(text).not.toMatch(/See also|Related topic|More|Nested back matter|Further Reading|Some book/);
  });

  it("leaves normal prose, lists and blockquotes alone", () => {
    const html = `
      <h2>Notes on technique</h2>
      <p>Normal <a href="/x">prose</a> with <sup>2</sup> superscript.</p>
      <ul><li>First item</li><li>Second item</li></ul>
      <ol><li>Step one</li></ol>
      <blockquote><p>A quotation.</p></blockquote>
    `;
    const root = body(html);
    const before = root.innerHTML;
    stripNonContent(root);
    expect(root.innerHTML).toBe(before);
  });
});
