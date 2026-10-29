import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/tests/fakes/storage";
import {
  saveDocument,
  searchDocuments,
} from "./documents";

let storage: MemoryStorage;
let now = 1_700_000_000_000;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function tick(ms = 1000) {
  now += ms;
}

describe("searchDocuments", () => {
  it("returns all documents for empty or whitespace query", () => {
    const a = saveDocument({ title: "A", text: "first", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "B", text: "second", source: "paste" }, storage);
    tick();
    const c = saveDocument({ title: "C", text: "third", source: "paste" }, storage);
    const all = searchDocuments("", storage);
    expect(all.map(d => d.id)).toEqual([c.id, b.id, a.id]);
  });

  it("case-insensitive title matches come first, then text or note", () => {
    const a = saveDocument({ title: "Alpha", text: "alpha text", source: "paste" }, storage);
    tick();
    const b = saveDocument({ title: "Beta", text: "beta text", source: "paste" }, storage);
    tick();
    const c = saveDocument({ title: "Gamma", text: "GammaText", source: "paste" }, storage);
    const res = searchDocuments("gamma", storage);
    expect(res.map(d => d.id)).toEqual([c.id, a.id, b.id]);
  });

  it("returns empty array when no matches", () => {
    const a = saveDocument({ title: "One", text: "two", source: "paste" }, storage);
    const res = searchDocuments("xyz", storage);
    expect(res).toEqual([]);
  });
});
