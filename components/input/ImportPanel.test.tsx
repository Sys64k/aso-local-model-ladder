import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recognizeImage } from "@/lib/import/ocr";
import { extractPdfText } from "@/lib/import/pdf";
import { normalizeText } from "@/lib/text/segment";
import { ImportPanel, MESSAGES, URL_ERROR_MESSAGES, type UrlErrorCode } from "./ImportPanel";

vi.mock("@/lib/import/ocr", () => ({ recognizeImage: vi.fn() }));
vi.mock("@/lib/import/pdf", () => ({ extractPdfText: vi.fn() }));

const ocrMock = vi.mocked(recognizeImage);
const pdfMock = vi.mocked(extractPdfText);
const fetchMock = vi.fn();

function setup() {
  const onImport = vi.fn();
  const user = userEvent.setup();
  render(<ImportPanel onImport={onImport} />);
  return { onImport, user };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

beforeEach(() => {
  ocrMock.mockReset();
  pdfMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImportPanel tabs", () => {
  it("renders four tabs following the WAI-ARIA tabs pattern", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Paste text",
      "Upload file",
      "Take photo",
      "Web page",
    ]);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    for (const t of tabs.slice(1)) {
      expect(t).toHaveAttribute("aria-selected", "false");
      expect(t).toHaveAttribute("tabindex", "-1");
    }
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tabs[0].id);
    expect(tabs[0]).toHaveAttribute("aria-controls", panel.id);
  });

  it("moves between tabs with arrow keys, Home and End (roving tabindex)", async () => {
    const { user } = setup();
    const tab = (name: string) => screen.getByRole("tab", { name });
    tab("Paste text").focus();

    await user.keyboard("{ArrowRight}");
    expect(tab("Upload file")).toHaveFocus();
    expect(tab("Upload file")).toHaveAttribute("aria-selected", "true");
    expect(tab("Upload file")).toHaveAttribute("tabindex", "0");
    expect(tab("Paste text")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab("Upload file").id);
    expect(screen.getByLabelText("Choose a file")).toBeVisible();

    await user.keyboard("{End}");
    expect(tab("Web page")).toHaveFocus();
    expect(screen.getByLabelText("Web page address")).toBeVisible();

    await user.keyboard("{ArrowRight}");
    expect(tab("Paste text")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(tab("Web page")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(tab("Paste text")).toHaveFocus();
    expect(screen.getByLabelText("Text to read")).toBeVisible();

    // Only the selected tab is in the tab order.
    await user.tab();
    expect(screen.getByLabelText("Text to read")).toHaveFocus();
  });
});

describe("paste", () => {
  it("calls onImport with normalized text, a derived title and source 'paste'", async () => {
    const { user, onImport } = setup();
    const raw = "  Hello   world.\r\nThis is a test-\nexample.\n\n\nSecond paragraph.  ";
    fireEvent.change(screen.getByLabelText("Text to read"), { target: { value: raw } });
    await user.click(screen.getByRole("button", { name: "Read this text" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    const doc = onImport.mock.calls[0][0];
    expect(doc.text).toBe(normalizeText(raw));
    expect(doc.text).toBe("Hello world. This is a testexample.\n\nSecond paragraph.");
    expect(doc.source).toBe("paste");
    expect(doc.title).toBe("Hello world.");
    expect(screen.getByRole("status")).toHaveTextContent("Text ready");
  });

  it("shows an error and does not import empty text", async () => {
    const { user, onImport } = setup();
    await user.type(screen.getByLabelText("Text to read"), "   ");
    await user.click(screen.getByRole("button", { name: "Read this text" }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.emptyPaste);
  });
});

describe("file upload", () => {
  async function openUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    return screen.getByLabelText("Choose a file") as HTMLInputElement;
  }

  it("accepts text, markdown, PDF and image files", async () => {
    const { user } = setup();
    const input = await openUpload(user);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".txt,.md,.pdf,image/*");
  });

  it("reads .txt files as plain text with the file name as title", async () => {
    const { user, onImport } = setup();
    const input = await openUpload(user);
    await user.upload(input, new File(["Line one\nline two.\n\nNext."], "My notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith({
      title: "My notes",
      text: "Line one line two.\n\nNext.",
      source: "file",
    });
    expect(ocrMock).not.toHaveBeenCalled();
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it("reads .md files without a MIME type as text", async () => {
    const { user, onImport } = setup();
    const input = await openUpload(user);
    await user.upload(input, new File(["# Title\n\nBody"], "readme.md", { type: "" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toMatchObject({ title: "readme", source: "file" });
  });

  it("sends PDFs to PDF extraction", async () => {
    pdfMock.mockResolvedValue("Page one text.\n\nPage two text.");
    const { user, onImport } = setup();
    const input = await openUpload(user);
    const file = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
    await user.upload(input, file);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(pdfMock).toHaveBeenCalledWith(file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onImport).toHaveBeenCalledWith({
      title: "report",
      text: "Page one text.\n\nPage two text.",
      source: "pdf",
    });
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it("explains what to do with a scanned PDF", async () => {
    pdfMock.mockRejectedValue(Object.assign(new Error("no text"), { code: "no_text_layer" }));
    const { user, onImport } = setup();
    const input = await openUpload(user);
    await user.upload(input, new File(["%PDF"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(MESSAGES.noTextLayer)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/photo|image/i);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("sends images to OCR with the chosen language", async () => {
    ocrMock.mockResolvedValue("Texto  de la\nimagen.");
    const { user, onImport } = setup();
    const input = await openUpload(user);
    const select = screen.getByLabelText("Text language");
    expect(select).toHaveValue("eng");
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => o.value),
    ).toEqual(["eng", "spa", "fra", "deu", "por", "ita"]);
    await user.selectOptions(select, "spa");
    const file = new File(["png"], "scan.png", { type: "image/png" });
    await user.upload(input, file);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(ocrMock).toHaveBeenCalledWith(file, expect.objectContaining({ lang: "spa" }));
    expect(onImport).toHaveBeenCalledWith({ title: "scan", text: "Texto de la imagen.", source: "image" });
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it("shows an error when OCR finds no text", async () => {
    ocrMock.mockResolvedValue("  \n ");
    const { user, onImport } = setup();
    const input = await openUpload(user);
    await user.upload(input, new File(["png"], "blank.png", { type: "image/png" }));
    expect(await screen.findByText(MESSAGES.emptyImage)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("rejects unsupported files", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup({ applyAccept: false });
    render(<ImportPanel onImport={onImport} />);
    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    await user.upload(
      screen.getByLabelText("Choose a file"),
      new File(["zip"], "archive.zip", { type: "application/zip" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.unsupportedFile);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("accepts files dropped on the keyboard-reachable drop zone", async () => {
    const { user, onImport } = setup();
    await openUpload(user);
    const zone = screen.getByRole("button", { name: /drop a file here/i });
    zone.focus();
    expect(zone).toHaveFocus();
    const file = new File(["Dropped text."], "dropped.txt", { type: "text/plain" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith({ title: "dropped", text: "Dropped text.", source: "file" });
  });
});

describe("take photo", () => {
  it("offers a camera input with a tip and runs OCR", async () => {
    ocrMock.mockResolvedValue("A photographed page of text.");
    const { user, onImport } = setup();
    await user.click(screen.getByRole("tab", { name: "Take photo" }));
    const input = screen.getByLabelText("Take a photo of text");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    expect(screen.getByText(/Hold the camera steady/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Text language"), "deu");
    const file = new File(["jpg"], "image.jpg", { type: "image/jpeg" });
    await user.upload(input, file);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(ocrMock).toHaveBeenCalledWith(file, expect.objectContaining({ lang: "deu" }));
    expect(onImport).toHaveBeenCalledWith({
      title: "A photographed page of text.",
      text: "A photographed page of text.",
      source: "image",
    });
  });
});

describe("web page", () => {
  async function submitUrl(user: ReturnType<typeof userEvent.setup>, url: string) {
    await user.click(screen.getByRole("tab", { name: "Web page" }));
    const input = screen.getByLabelText("Web page address");
    expect(input).toHaveAttribute("type", "url");
    await user.type(input, url);
    await user.click(screen.getByRole("button", { name: "Get text" }));
  }

  it("posts the URL to /api/extract and imports the article", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "An Article",
          text: "First   paragraph.\n\n\nSecond.",
          byline: null,
          siteName: "Example",
          url: "https://example.com/a",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { user, onImport } = setup();
    await submitUrl(user, "https://example.com/a");
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("/api/extract");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/a" });
    expect(onImport).toHaveBeenCalledWith({
      title: "An Article",
      text: "First paragraph.\n\nSecond.",
      source: "url",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Text ready");
  });

  it("announces that the page is being fetched", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const { user } = setup();
    await submitUrl(user, "https://example.com/");
    expect(screen.getByRole("status")).toHaveTextContent("Fetching page…");
    expect(screen.getByRole("region", { name: "Add text to read" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Get text" })).toBeDisabled();
    await act(async () => {
      pending.resolve(new Response(JSON.stringify({ title: "", text: "Hi there." }), { status: 200 }));
    });
    expect(screen.getByRole("region", { name: "Add text to read" })).toHaveAttribute("aria-busy", "false");
  });

  const codes = Object.keys(URL_ERROR_MESSAGES) as UrlErrorCode[];
  it.each(codes)("shows a friendly message for %s", async (code) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: code }), { status: 400 }),
    );
    const { user, onImport } = setup();
    await submitUrl(user, "https://example.com/x");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(URL_ERROR_MESSAGES[code]),
    );
    expect(onImport).not.toHaveBeenCalled();
  });

  it("has a distinct, human-readable message for every error code", () => {
    const messages = Object.values(URL_ERROR_MESSAGES);
    expect(new Set(messages).size).toBe(6);
    for (const m of messages) {
      expect(m).not.toMatch(/_/);
      expect(m.length).toBeGreaterThan(20);
    }
  });

  it("shows a network message when fetch fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user } = setup();
    await submitUrl(user, "https://example.com/x");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.network));
  });

  it("asks for an address when the field is empty", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "Web page" }));
    await user.click(screen.getByRole("button", { name: "Get text" }));
    expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.emptyUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("text statistics", () => {
  const LONG = "Hello there, friend."; // exactly 20 characters
  const SHORT = "Hello there friend."; // 19 characters
  const STATS = { words: 123, sentences: 7, paragraphs: 3, minutes: 2 };

  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Matches "123 words" as well as "Words: 123". */
  function stat(n: number, label: string) {
    return new RegExp(`((?<![\\d.])${n}\\s*${label})|(${label}\\w*\\s*:?\\s*${n}(?!\\d))`, "i");
  }

  function pastePanel() {
    return screen.getByRole("tabpanel");
  }

  function panelText() {
    return pastePanel().textContent ?? "";
  }

  function expectStats(s: typeof STATS) {
    const text = panelText();
    expect(text).toMatch(stat(s.words, "words?"));
    expect(text).toMatch(stat(s.sentences, "sentences?"));
    expect(text).toMatch(stat(s.paragraphs, "paragraphs?"));
    expect(text).toMatch(stat(s.minutes, "min"));
  }

  function expectNoStats() {
    const text = panelText();
    expect(text).not.toMatch(/\bwords?\b/i);
    expect(text).not.toMatch(/\bsentences?\b/i);
    expect(text).not.toMatch(/\bparagraphs?\b/i);
    expect(text).not.toMatch(/\bmin(ute)?s?\b/i);
  }

  function paste(text: string) {
    fireEvent.change(screen.getByLabelText("Text to read"), { target: { value: text } });
  }

  function statsCalls() {
    return fetchMock.mock.calls.filter(([endpoint]) => endpoint === "/api/stats");
  }

  const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

  it("shows nothing before any text is pasted", () => {
    setup();
    expectNoStats();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts pasted text to /api/stats and shows the numbers under it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATS));
    setup();
    paste(LONG);
    await waitFor(() => expectStats(STATS));
    expect(statsCalls().length).toBeGreaterThanOrEqual(1);
    const [, init] = statsCalls()[statsCalls().length - 1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: LONG });
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("does not fetch or show numbers for text under 20 characters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATS));
    setup();
    paste(SHORT);
    await wait(700);
    expect(statsCalls()).toHaveLength(0);
    expectNoStats();
  });

  it("does not count surrounding whitespace towards the 20 characters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATS));
    setup();
    paste(`   ${SHORT}   \n\n`);
    await wait(700);
    expect(statsCalls()).toHaveLength(0);
    expectNoStats();
  });

  it("hides the numbers when the text becomes too short again", async () => {
    fetchMock.mockResolvedValue(jsonResponse(STATS));
    setup();
    paste(LONG);
    await waitFor(() => expectStats(STATS));
    paste(SHORT);
    await waitFor(() => expectNoStats());
  });

  it("shows the numbers for the latest text when responses arrive out of order", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    setup();
    paste(LONG);
    await waitFor(() => expect(statsCalls()).toHaveLength(1));
    const later = `${LONG} And some more words here.`;
    paste(later);
    await waitFor(() => expect(statsCalls()).toHaveLength(2));
    expect(JSON.parse(statsCalls()[1][1].body)).toEqual({ text: later });

    const latest = { words: 9, sentences: 2, paragraphs: 1, minutes: 1 };
    await act(async () => second.resolve(jsonResponse(latest)));
    await waitFor(() => expectStats(latest));
    await act(async () => first.resolve(jsonResponse(STATS)));
    await wait(50);
    expectStats(latest);
    expect(panelText()).not.toMatch(stat(STATS.words, "words?"));
  });

  it("shows no numbers and no error when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    setup();
    paste(LONG);
    await waitFor(() => expect(statsCalls().length).toBeGreaterThanOrEqual(1));
    await wait(50);
    expectNoStats();
    expect(screen.getByRole("alert")).toHaveTextContent("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each([
    ["a 413 response", () => jsonResponse({ error: "too_large" }, 413)],
    ["a 500 response", () => jsonResponse({ error: "boom" }, 500)],
    ["a non-JSON response", () => new Response("<html>oops</html>", { status: 200 })],
    ["a response without numbers", () => jsonResponse({ hello: "world" })],
  ])("shows no numbers and no error for %s", async (_label, make) => {
    fetchMock.mockImplementation(async () => make());
    setup();
    paste(LONG);
    await waitFor(() => expect(statsCalls().length).toBeGreaterThanOrEqual(1));
    await wait(50);
    expectNoStats();
    expect(screen.getByRole("alert")).toHaveTextContent("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears earlier numbers when a later request fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(STATS)).mockRejectedValue(new TypeError("Failed to fetch"));
    setup();
    paste(LONG);
    await waitFor(() => expectStats(STATS));
    paste(`${LONG} With a few more words.`);
    await waitFor(() => expect(statsCalls()).toHaveLength(2));
    await waitFor(() => expectNoStats());
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("still imports pasted text when the stats request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { user, onImport } = setup();
    paste(LONG);
    await user.click(screen.getByRole("button", { name: "Read this text" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toMatchObject({ text: LONG, source: "paste" });
  });
});

describe("progress, status and cancel", () => {
  it("has a polite status region and an alert region", () => {
    setup();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("announces OCR progress at most once per 10%", async () => {
    const pending = deferred<string>();
    let report: (p: number) => void = () => {};
    ocrMock.mockImplementation((_file, opts) => {
      report = opts.onProgress!;
      return pending.promise;
    });
    const { user, onImport } = setup();
    await user.click(screen.getByRole("tab", { name: "Take photo" }));
    await user.upload(
      screen.getByLabelText("Take a photo of text"),
      new File(["jpg"], "photo.jpg", { type: "image/jpeg" }),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Reading image…");
    expect(screen.getByRole("region", { name: "Add text to read" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Take a photo of text")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    const seen: string[] = [status.textContent ?? ""];
    for (const p of [0.01, 0.05, 0.11, 0.15, 0.19, 0.4, 0.42, 0.45, 0.49]) {
      act(() => report(p));
      const text = status.textContent ?? "";
      if (text !== seen[seen.length - 1]) seen.push(text);
    }
    expect(seen).toEqual(["Reading image…", "Reading image… 10%", "Reading image… 40%"]);

    await act(async () => pending.resolve("Done reading."));
    expect(status).toHaveTextContent("Text ready");
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("announces PDF pages", async () => {
    const pending = deferred<string>();
    let report: (page: number, total: number) => void = () => {};
    pdfMock.mockImplementation((_file, opts) => {
      report = opts!.onProgress!;
      return pending.promise;
    });
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    await user.upload(
      screen.getByLabelText("Choose a file"),
      new File(["%PDF"], "book.pdf", { type: "application/pdf" }),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Opening PDF…");
    act(() => report(2, 5));
    expect(status).toHaveTextContent("Extracting PDF page 2 of 5");
    await act(async () => pending.resolve("All the text."));
    expect(status).toHaveTextContent("Text ready");
  });

  it("can cancel PDF extraction", async () => {
    let signal: AbortSignal | undefined;
    pdfMock.mockImplementation(
      (_file, opts) =>
        new Promise<string>((_, reject) => {
          signal = opts?.signal;
          signal?.addEventListener("abort", () => reject(abortError()));
        }),
    );
    const { user, onImport } = setup();
    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    await user.upload(
      screen.getByLabelText("Choose a file"),
      new File(["%PDF"], "long.pdf", { type: "application/pdf" }),
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
    expect(screen.getByRole("alert")).toHaveTextContent("");
    expect(screen.getByLabelText("Choose a file")).toBeEnabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("ignores an OCR result that arrives after cancelling", async () => {
    const pending = deferred<string>();
    ocrMock.mockReturnValue(pending.promise);
    const { user, onImport } = setup();
    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    await user.upload(
      screen.getByLabelText("Choose a file"),
      new File(["png"], "img.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => pending.resolve("Too late."));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
  });
});
