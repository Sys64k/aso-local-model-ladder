import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import {
  DOCUMENTS_STORAGE_KEY,
  deleteDocument,
  deriveTitle,
  getDocument,
  listDocuments,
  saveDocument,
  updateProgress,
} from "./documents";

let storage: MemoryStorage;
let now: number;

beforeEach(() => {
  storage = new MemoryStorage();
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tick(ms = 1000) {
  now += ms;
}

describe("document store", () => {
  it("saves and retrieves a document", () => {
    const doc = saveDocument({ title: "My doc", text: "Hello world.", source: "paste" }, storage);
    expect(doc).toMatchObject({
      title: "My doc",
      text: "Hello world.",
      source: "paste",
      createdAt: now,
      updatedAt: now,
      lastSentenceIndex: 0,
    });
    expect(typeof doc.id).toBe("string");
    expect(doc.id.length).toBeGreaterThan(0);
    expect(getDocument(doc.id, storage)).toEqual(doc);
    expect(getDocument("missing", storage)).toBeNull();
    expect(storage.getItem(DOCUMENTS_STORAGE_KEY)).toContain("Hello world.");
  });

  it("derives a title when none is given", () => {
    const doc = saveDocument({ title: "  ", text: "First sentence. Second.", source: "file" }, storage);
    expect(doc.title).toBe("First sentence.");
  });

  it("lists newest first", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    const c = saveDocument({ title: "C", text: "c", source: "paste" }, storage);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([c.id, b.id, a.id]);
  });

  it("keeps newest first even with identical timestamps", () => {
    saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    expect(listDocuments(storage)[0].id).toBe(b.id);
  });

  it("caps at 20 entries, dropping the oldest", () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      ids.push(saveDocument({ title: `D${i}`, text: `text ${i}`, source: "paste" }, storage).id);
      tick();
    }
    const list = listDocuments(storage);
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe(ids[24]);
    expect(list[19].id).toBe(ids[5]);
    expect(list.some((d) => d.id === ids[4])).toBe(false);
  });

  it("does not duplicate identical text; updates the existing entry", () => {
    const first = saveDocument({ title: "Old", text: "Same text.", source: "paste" }, storage);
    updateProgress(first.id, 3, storage);
    tick();
    const other = saveDocument({ title: "Other", text: "Different.", source: "paste" }, storage);
    tick();
    const again = saveDocument({ title: "New", text: "Same text.", source: "file" }, storage);
    expect(again.id).toBe(first.id);
    expect(again.title).toBe("New");
    expect(again.source).toBe("file");
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.updatedAt).toBe(now);
    expect(again.lastSentenceIndex).toBe(3);
    const list = listDocuments(storage);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id)).toEqual([first.id, other.id]);
  });

  it("updates progress and moves the document to the top", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    tick();
    updateProgress(a.id, 7, storage);
    expect(getDocument(a.id, storage)?.lastSentenceIndex).toBe(7);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([a.id, b.id]);
    expect(() => updateProgress("missing", 1, storage)).not.toThrow();
    updateProgress(a.id, -4, storage);
    expect(getDocument(a.id, storage)?.lastSentenceIndex).toBe(0);
  });

  it("deletes documents", () => {
    const a = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    const b = saveDocument({ title: "B", text: "b", source: "paste" }, storage);
    deleteDocument(a.id, storage);
    expect(listDocuments(storage).map((d) => d.id)).toEqual([b.id]);
    expect(() => deleteDocument("missing", storage)).not.toThrow();
  });

  it("ignores corrupt or malformed stored data", () => {
    storage.setItem(DOCUMENTS_STORAGE_KEY, "{oops");
    expect(listDocuments(storage)).toEqual([]);
    storage.setItem(
      DOCUMENTS_STORAGE_KEY,
      JSON.stringify([{ id: 1 }, null, "x", { id: "ok", title: "t", text: "x", source: "bogus" }]),
    );
    expect(listDocuments(storage)).toEqual([]);
    const doc = saveDocument({ title: "A", text: "a", source: "pdf" }, storage);
    expect(listDocuments(storage)).toEqual([doc]);
  });

  it("never throws when storage fails", () => {
    const ok = saveDocument({ title: "A", text: "a", source: "paste" }, storage);
    storage.failWrites = true;
    let doc: ReturnType<typeof saveDocument> | undefined;
    expect(() => {
      doc = saveDocument({ title: "B", text: "b", source: "url" }, storage);
    }).not.toThrow();
    expect(doc?.title).toBe("B");
    expect(() => updateProgress(ok.id, 2, storage)).not.toThrow();
    expect(() => deleteDocument(ok.id, storage)).not.toThrow();

    storage.failReads = true;
    expect(listDocuments(storage)).toEqual([]);
    expect(getDocument(ok.id, storage)).toBeNull();
    expect(() => saveDocument({ title: "C", text: "c", source: "image" }, storage)).not.toThrow();
    expect(() => updateProgress(ok.id, 2, storage)).not.toThrow();
    expect(() => deleteDocument(ok.id, storage)).not.toThrow();
  });
});

describe("deriveTitle", () => {
  it("uses the first sentence when short", () => {
    expect(deriveTitle("Short title. And more text follows here.")).toBe("Short title.");
  });

  it("cuts long sentences at a word boundary with an ellipsis", () => {
    const text =
      "This is a rather long first sentence that keeps going well past the sixty character limit. Next.";
    const title = deriveTitle(text);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    const body = title.slice(0, -1);
    expect(text.startsWith(body)).toBe(true);
    expect(text[body.length]).toBe(" ");
    expect(title).toBe("This is a rather long first sentence that keeps going well…");
  });

  it("collapses whitespace and handles empty text", () => {
    expect(deriveTitle("  Hello\n\n   world  ")).toBe("Hello world");
    expect(deriveTitle("   ")).toBe("Untitled");
  });

  it("hard-cuts a single very long word", () => {
    const title = deriveTitle("x".repeat(100));
    expect(title).toBe(`${"x".repeat(60)}…`);
  });
});
