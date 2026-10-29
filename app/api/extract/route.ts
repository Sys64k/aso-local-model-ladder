import {
  ExtractError,
  type ExtractErrorCode,
  extractReadable,
  fetchHtml,
} from "@/lib/server/extract";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 10 * 1024;

const STATUS_BY_CODE: Record<ExtractErrorCode, number> = {
  invalid_url: 400,
  blocked_host: 403,
  too_large: 413,
  unsupported_content: 415,
  no_content: 422,
  fetch_failed: 502,
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(code: ExtractErrorCode): Response {
  return json({ error: code }, STATUS_BY_CODE[code]);
}

/** Reads the request body as text, failing once it exceeds `maxBytes`. */
async function readRequestText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseTargetUrl(raw: string): URL | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const value = (body as { url?: unknown }).url;
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

export async function POST(request: Request) {: Promise<Response> {
  let raw: string | null;
  try {
    raw = await readRequestText(request, MAX_REQUEST_BYTES);
  } catch {
    return errorResponse("invalid_url");
  }
  if (raw === null) return errorResponse("too_large");

  const target = parseTargetUrl(raw);
  if (!target) return errorResponse("invalid_url");

  try {
    const { html, finalUrl } = await fetchHtml(target.toString());
    const article = extractReadable(html, finalUrl);
    return json(
      {
        title: article.title,
        text: article.text,
        byline: article.byline,
        siteName: article.siteName,
        url: finalUrl,
      },
      200,
    );
  } catch (err) {
    if (err instanceof ExtractError) return errorResponse(err.code);
    console.error("[api/extract] unexpected error", err);
    return errorResponse("fetch_failed");
  }
}
