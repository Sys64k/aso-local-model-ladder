import { describe, expect, it } from "vitest";
import { detectKind, readAsText, titleFromFileName } from "./readFile";

const f = (name: string, type = "") => new File(["x"], name, { type });

describe("detectKind", () => {
  it("uses the MIME type", () => {
    expect(detectKind(f("a", "text/plain"))).toBe("text");
    expect(detectKind(f("a", "text/markdown"))).toBe("text");
    expect(detectKind(f("a", "application/pdf"))).toBe("pdf");
    expect(detectKind(f("a", "image/png"))).toBe("image");
    expect(detectKind(f("a", "image/jpeg"))).toBe("image");
  });

  it("prefers the MIME type over the extension", () => {
    expect(detectKind(f("photo.txt", "image/jpeg"))).toBe("image");
    expect(detectKind(f("doc.png", "application/pdf"))).toBe("pdf");
  });

  it("falls back to the extension (case-insensitive)", () => {
    expect(detectKind(f("notes.txt"))).toBe("text");
    expect(detectKind(f("README.MD"))).toBe("text");
    expect(detectKind(f("paper.PDF", "application/octet-stream"))).toBe("pdf");
    expect(detectKind(f("scan.JPG"))).toBe("image");
    expect(detectKind(f("scan.webp"))).toBe("image");
  });

  it("returns 'unsupported' for anything else", () => {
    expect(detectKind(f("archive.zip", "application/zip"))).toBe("unsupported");
    expect(detectKind(f("page.html", "text/html"))).toBe("unsupported");
    expect(detectKind(f("noextension"))).toBe("unsupported");
    expect(detectKind(f(".txt"))).toBe("unsupported");
  });
});

describe("titleFromFileName", () => {
  it("strips the extension and directories", () => {
    expect(titleFromFileName("My notes.txt")).toBe("My notes");
    expect(titleFromFileName("report.v2.pdf")).toBe("report.v2");
    expect(titleFromFileName("C:\\docs\\letter.md")).toBe("letter");
    expect(titleFromFileName("README")).toBe("README");
  });
});

describe("readAsText", () => {
  it("reads a blob as text", async () => {
    await expect(readAsText(new Blob(["héllo"]))).resolves.toBe("héllo");
  });
});
