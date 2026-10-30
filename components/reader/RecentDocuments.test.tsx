import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SavedDocument } from "@/lib/documents";
import { RecentDocuments } from "./RecentDocuments";

function makeDoc(title: string, id: string): SavedDocument {
  return {
    id,
    title,
    text: `${title} text.`,
    source: "paste",
    createdAt: Date.UTC(2024, 0, 1),
    updatedAt: Date.UTC(2024, 0, 2),
    lastSentenceIndex: 0,
    note: "",
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderList(documents: SavedDocument[]) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onClear = vi.fn();
  const headingRef = { current: document.createElement('h2') };
  render(<RecentDocuments documents={documents} onOpen={onOpen} onDelete={onDelete} onClear={onClear} headingRef={headingRef} />);
  return { onOpen, onDelete, onClear };
}

describe("RecentDocuments", () => {
  it("calls onOpen and onDelete", async () => {
    const user = userEvent.setup();
    const doc = makeDoc("My letter", "doc-1");
    const { onOpen, onDelete } = renderList([doc]);
    await user.click(screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(doc.title)}`) }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(doc);
    await user.click(screen.getByRole("button", { name: "Delete My letter" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(doc);
  });

  it("shows Clear all button when documents exist", async () => {
    const user = userEvent.setup();
    const docs = [makeDoc("First", "doc-1"), makeDoc("Second", "doc-2")];
    renderList(docs);
    expect(screen.getByRole("button", { name: "Clear all" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("heading", { level: 2, name: "Clear recent documents?" })).toBeVisible();
  });

  it("hides Clear all button when there are no documents", () => {
    renderList([]);
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("clears all documents when confirming", async () => {
    const user = userEvent.setup();
    const { onClear } = renderList([
      makeDoc("First", "doc-1"),
      makeDoc("Second", "doc-2"),
      makeDoc("Third", "doc-3"),
    ]);

    // Open the confirmation dialog
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    // Verify dialog is open
    expect(screen.getByRole("heading", { level: 2, name: "Clear recent documents?" })).toBeVisible();

    // Confirm the clear action
    await user.click(screen.getByRole("button", { name: "Clear" }));

    // onClear should have been called
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("keeps all documents when cancelling", async () => {
    const user = userEvent.setup();
    const { onClear, onOpen, onDelete } = renderList([
      makeDoc("First", "doc-1"),
      makeDoc("Second", "doc-2"),
    ]);

    // Open the confirmation dialog
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    // Cancel the clear action
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Dialog should close
    expect(screen.queryByRole("heading", { level: 2, name: "Clear recent documents?" })).not.toBeInTheDocument();

    // onClear should not have been called
    expect(onClear).not.toHaveBeenCalled();

    // The original event handlers should not have been triggered
    expect(onOpen).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
