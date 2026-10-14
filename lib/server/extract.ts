import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

export type ExtractErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "too_large"
  | "unsupported_content"
  | "no_content"
  | "fetch_failed";

export class ExtractError extends Error {
  code: ExtractErrorCode;

  constructor(code: ExtractErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ExtractError";
    this.code = code;
  }
}

export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export type FetchHtmlOptions = {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  /** Overall timeout covering all redirect hops and the body download. */
  timeoutMs?: number;
  /** Maximum number of response body bytes. */
  maxBytes?: number;
};

export type ExtractedArticle = {
  title: string;
  text: string;
  byline: string | null;
  siteName: string | null;
};

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const MIN_TEXT_LENGTH = 50;
export const USER_AGENT =
  "Mozilla/5.0 (compatible; ReadAloudBot/1.0; +https://github.com/readaloud)";

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands an IPv6 address into eight 16-bit groups, or null if invalid. */
function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  // Embedded IPv4 tail, e.g. ::ffff:10.0.0.1 -> ::ffff:a00:1
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColon = ip.split("::");
  if (doubleColon.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const groups: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };

  if (doubleColon.length === 2) {
    const head = toGroups(doubleColon[0]);
    const rest = toGroups(doubleColon[1]);
    if (!head || !rest) return null;
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...rest];
  }
  const all = toGroups(ip);
  if (!all || all.length !== 8) return null;
  return all;
}

function isPrivateIPv6(g: number[]): boolean {
  const allZero = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  const embeddedV4 = () => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];

  if (allZero(0, 8)) return true; // ::
  if (allZero(0, 7) && g[7] === 1) return true; // ::1
  if (allZero(0, 5) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4()); // ::ffff:a.b.c.d
  if (allZero(0, 6)) return isPrivateIPv4(embeddedV4()); // deprecated ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) {
    return isPrivateIPv4(embeddedV4()); // NAT64 64:ff9b::/96
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/**
 * Returns true for any address that must not be fetched: private, loopback,
 * link-local, multicast or otherwise reserved. Unparsable input is treated as
 * private (fail closed).
 */
export function isPrivateAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const v4 = parseIPv4(trimmed);
  if (v4) return isPrivateIPv4(v4);
  if (trimmed.includes(":")) {
    const v6 = parseIPv6(trimmed);
    if (v6) return isPrivateIPv6(v6);
  }
  return true;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Ensures the URL uses http(s) and that every address its host resolves to is
 * public. Throws ExtractError otherwise.
 */
export async function assertPublicUrl(
  url: URL,
  lookup: LookupFn = dnsLookup,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractError("invalid_url", `Unsupported protocol ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!host) throw new ExtractError("invalid_url", "Missing host");

  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new ExtractError("blocked_host", `Blocked host ${host}`);
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new ExtractError("blocked_host", `Blocked address ${host}`);
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new ExtractError("fetch_failed", `DNS lookup failed for ${host}`);
  }
  if (!addresses || addresses.length === 0) {
    throw new ExtractError("fetch_failed", `No addresses for ${host}`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new ExtractError("blocked_host", `${host} resolves to ${address}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function parseContentType(header: string | null): {
  mime: string;
  charset: string | null;
} {
  if (!header) return { mime: "", charset: null };
  const [mime, ...params] = header.split(";");
  let charset: string | null = null;
  for (const param of params) {
    const [key, value] = param.split("=");
    if (key?.trim().toLowerCase() === "charset" && value) {
      charset = value.trim().replace(/^["']|["']$/g, "");
    }
  }
  return { mime: mime.trim().toLowerCase(), charset };
}

function decode(bytes: Uint8Array, charset: string | null): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // unknown label: fall through to UTF-8
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  // Make sure a stalled body cannot outlive the timeout, even if the fetch
  // implementation does not tie the body stream to the abort signal.
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new ExtractError("fetch_failed", "Timed out");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new ExtractError("fetch_failed", "Timed out");
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => {});
        throw new ExtractError("too_large", `Body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetches an HTML page, following up to MAX_REDIRECTS redirects manually and
 * re-validating every hop against SSRF rules.
 */
export async function fetchHtml(
  url: string,
  opts: FetchHtmlOptions = {},
): Promise<{ html: string; finalUrl: string }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const lookup = opts.lookup ?? dnsLookup;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new ExtractError("invalid_url", "Unparsable URL");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(current, lookup);
      if (timedOut) throw new ExtractError("fetch_failed", "Timed out");

      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          },
        });
      } catch (err) {
        throw new ExtractError(
          "fetch_failed",
          timedOut ? "Timed out" : `Network error: ${(err as Error)?.message ?? err}`,
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await discardBody(response);
        if (!location) {
          throw new ExtractError("fetch_failed", `Redirect without location`);
        }
        if (hop >= MAX_REDIRECTS) {
          throw new ExtractError("fetch_failed", "Too many redirects");
        }
        try {
          current = new URL(location, current);
        } catch {
          throw new ExtractError("fetch_failed", "Invalid redirect location");
        }
        if (current.protocol !== "http:" && current.protocol !== "https:") {
          throw new ExtractError("fetch_failed", "Redirect to unsupported protocol");
        }
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await discardBody(response);
        throw new ExtractError("fetch_failed", `Upstream status ${response.status}`);
      }

      const { mime, charset } = parseContentType(response.headers.get("content-type"));
      if (!ALLOWED_CONTENT_TYPES.has(mime)) {
        await discardBody(response);
        throw new ExtractError("unsupported_content", `Content-Type ${mime || "missing"}`);
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await discardBody(response);
        throw new ExtractError("too_large", `Content-Length ${declaredLength}`);
      }

      let bytes: Uint8Array;
      try {
        bytes = await readBodyCapped(response, maxBytes, controller.signal);
      } catch (err) {
        if (err instanceof ExtractError) throw err;
        throw new ExtractError("fetch_failed", timedOut ? "Timed out" : "Body read failed");
      }

      return { html: decode(bytes, charset), finalUrl: current.toString() };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Elements that start a new paragraph. */
const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  // structural containers: treated as paragraph boundaries too
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "table",
  "tr",
  "hr",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "math"]);

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Converts an element tree into plain text paragraphs. */
function htmlToParagraphs(root: Element): string[] {
  const paragraphs: string[] = [];
  let buffer = "";

  const flush = () => {
    const text = collapseWhitespace(buffer);
    if (text) paragraphs.push(text);
    buffer = "";
  };

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        buffer += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
      const tag = (child as Element).localName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === "br" || tag === "td" || tag === "th") {
        buffer += " ";
        if (tag !== "br") {
          walk(child);
          buffer += " ";
        }
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        flush();
        walk(child);
        flush();
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  flush();
  return paragraphs;
}

/** Page clutter that must never be read aloud. */
const NON_CONTENT_SELECTORS = [
  // infoboxes and side panels
  ".infobox",
  ".sidebar",
  ".vertical-navbox",
  ".metadata",
  ".ambox",
  ".hatnote",
  ".shortdescription",
  "[role=note]",
  // navigation
  "nav",
  "[role=navigation]",
  ".navbox",
  ".navbox-styles",
  ".navigation-not-searchable",
  "#toc",
  ".toc",
  ".mw-jump-link",
  "#catlinks",
  ".catlinks",
  ".printfooter",
  ".mw-editsection",
  ".noprint",
  ".breadcrumb",
  ".breadcrumbs",
  // tables, including data tables
  "table",
  // reference lists and citation markers
  "ol.references",
  ".references",
  ".reflist",
  ".mw-references-wrap",
  ".refbegin",
  "sup.reference",
  "sup.noprint",
  ".mw-cite-backlink",
  "[role=doc-endnotes]",
  "[role=doc-bibliography]",
  "[role=doc-noteref]",
].join(",");

const BACK_MATTER_HEADINGS = new Set([
  "references",
  "notes",
  "footnotes",
  "citations",
  "sources",
  "bibliography",
  "external links",
  "see also",
  "further reading",
]);

/** Returns the heading level (1–6) of an h1–h6 element, otherwise null. */
function headingTagLevel(el: Element): number | null {
  const match = /^h([1-6])$/.exec(el.localName.toLowerCase());
  return match ? Number(match[1]) : null;
}

/**
 * Returns the heading level of a sibling-level node: either a bare h1–h6 or a
 * MediaWiki `div.mw-heading` wrapper around one. Otherwise null.
 */
function blockHeadingLevel(el: Element): number | null {
  const direct = headingTagLevel(el);
  if (direct !== null) return direct;
  if (el.classList.contains("mw-heading")) {
    const inner = el.querySelector("h1, h2, h3, h4, h5, h6");
    if (inner) return headingTagLevel(inner);
    const cls = /\bmw-heading([1-6])\b/.exec(el.className);
    if (cls) return Number(cls[1]);
  }
  return null;
}

function normalizeHeadingText(text: string): string {
  return collapseWhitespace(text)
    .replace(/\s*\[\s*edit\s*\]\s*$/i, "")
    .trim()
    .toLowerCase();
}

/** Removes back-matter sections (References, See also, …) in place. */
function stripBackMatterSections(root: Document | Element): void {
  for (const heading of Array.from(root.querySelectorAll("h2, h3, h4"))) {
    // Skip headings already removed together with an earlier section.
    if (!root.contains(heading)) continue;
    const level = headingTagLevel(heading);
    if (level === null) continue;
    if (!BACK_MATTER_HEADINGS.has(normalizeHeadingText(heading.textContent ?? ""))) {
      continue;
    }

    const parent = heading.parentElement;
    const block = parent && parent.classList.contains("mw-heading") ? parent : heading;

    let sibling = block.nextSibling;
    while (sibling) {
      if (sibling.nodeType === 1 /* ELEMENT_NODE */) {
        const siblingLevel = blockHeadingLevel(sibling as Element);
        if (siblingLevel !== null && siblingLevel <= level) break;
      }
      const next = sibling.nextSibling;
      sibling.parentNode?.removeChild(sibling);
      sibling = next;
    }
    block.remove();
  }
}

/**
 * Removes infoboxes, navigation, tables, reference lists, citation markers,
 * edit links and back-matter sections from `root` in place.
 */
export function stripNonContent(root: Document | Element): void {
  for (const el of Array.from(root.querySelectorAll(NON_CONTENT_SELECTORS))) {
    el.remove();
  }
  stripBackMatterSections(root);
}

/**
 * Extracts the main readable content of an HTML document as plain text with
 * paragraphs separated by blank lines.
 */
export function extractReadable(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const documentTitle = collapseWhitespace(document.title ?? "");

    stripNonContent(document);
    const article = new Readability(document).parse();
    if (!article || !article.content) {
      throw new ExtractError("no_content", "Readability found no article");
    }

    const container = document.createElement("div");
    container.innerHTML = article.content;
    // Readability may keep or re-wrap some clutter, so clean its output too.
    stripNonContent(container);
    const text = htmlToParagraphs(container).join("\n\n");

    if (text.length < MIN_TEXT_LENGTH) {
      throw new ExtractError("no_content", "Article text too short");
    }

    const title = collapseWhitespace(article.title ?? "") || documentTitle;
    const byline = collapseWhitespace(article.byline ?? "") || null;
    const siteName = collapseWhitespace(article.siteName ?? "") || null;

    return { title, text, byline, siteName };
  } finally {
    dom.window.close();
  }
}
