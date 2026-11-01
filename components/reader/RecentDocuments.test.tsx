import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SavedDocument } from "@/lib/documents";
import { RecentDocuments } from "./RecentDocuments";

function makeDoc(overrides: Partial<SavedDocument> = {}): SavedDocument {
  return {
    id: "doc-1",
    title: "My letter",
    text: "Dear friend. Hello there.",
    source: "paste",
    createdAt: Date.UTC(2024, 0, 1),
    updatedAt: Date.UTC(2024, 0, 2),
    lastSentenceIndex: 0,
    note: "",
    ...overrides,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderList(documents: SavedDocument[]) {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  const onClearAll = vi.fn();
  render(
    <RecentDocuments
      documents={documents}
      onOpen={onOpen}
      onDelete={onDelete}
      onClearAll={onClearAll}
    />,
  );
  return { onOpen, onDelete, onClearAll };
}

describe("RecentDocuments note preview", () => {
  it("shows a preview for a document with a note", () => {
    renderList([makeDoc({ note: "Call the bank on Monday" })]);
    const preview = screen.getByTestId("note-preview");
    expect(preview).toHaveTextContent("Note: Call the bank on Monday");
    const openButton = screen.getByRole("button", { name: /^My letter/ });
    expect(within(openButton).getByTestId("note-preview")).toBe(preview);
  });

  it("collapses multi-line notes into a single line", () => {
    renderList([makeDoc({ note: "First line\n\nSecond   line" })]);
    expect(screen.getByTestId("note-preview").textContent).toBe("Note: First line Second line");
  });

  it("shows no preview for blank or whitespace-only notes", () => {
    renderList([
      makeDoc({ id: "a", title: "Blank note", note: "" }),
      makeDoc({ id: "b", title: "Spaces note", note: "   \n\t  " }),
    ]);
    expect(screen.queryByTestId("note-preview")).not.toBeInTheDocument();
    for (const title of ["Blank note", "Spaces note"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${title}`) });
      expect(button).not.toHaveTextContent("Note:");
      expect(button.querySelectorAll("span")).toHaveLength(2);
    }
  });

  it("truncates long notes with an ellipsis", () => {
    const longNote = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    renderList([makeDoc({ note: longNote })]);
    const text = screen.getByTestId("note-preview").textContent ?? "";
    expect(text.startsWith("Note: word0 word1")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    const preview = text.slice("Note: ".length);
    expect(preview.length).toBeLessThanOrEqual(81);
    expect(text).not.toContain("word39");
  });

  it("keeps the title at the start of the open button's accessible name", () => {
    renderList([makeDoc({ title: "Shopping list", note: "Remember milk" })]);
    const button = screen.getByRole("button", { name: /^Shopping list/ });
    expect(button).toHaveAccessibleName(expect.stringMatching(/^Shopping list /));
    expect(button).toHaveAccessibleName(expect.stringContaining("Note: Remember milk"));
    expect(button).toHaveAccessibleName(expect.stringMatching(/\d Note: Remember milk$/));
  });

  it("still calls onOpen and onDelete", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ note: "Some note" });
    const { onOpen, onDelete } = renderList([doc]);
    await user.click(screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(doc.title)}`) }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(doc);
    await user.click(screen.getByRole("button", { name: "Delete My letter" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(doc);
  });
});

describe("RecentDocuments clear all", () => {
  const twoDocs = () => [
    makeDoc({ id: "a", title: "First doc" }),
    makeDoc({ id: "b", title: "Second doc" }),
  ];

  function clearAllButton(): HTMLElement {
    return screen.getByRole("button", { name: "Clear all" });
  }

  function dialog(): HTMLElement {
    return screen.getByRole("dialog");
  }

  it("hides the Clear all button when there are no documents", () => {
    renderList([]);
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the Clear all button with a single document", () => {
    renderList([makeDoc()]);
    expect(clearAllButton()).toBeInTheDocument();
    expect(clearAllButton()).toHaveAttribute("type", "button");
    expect(clearAllButton().className).toMatch(/\bmin-h-(1[2-9]|[2-9]\d)\b/);
  });

  it("does not open a dialog or clear anything until the button is pressed", () => {
    const { onClearAll } = renderList(twoDocs());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("opens a modal confirmation dialog without clearing yet", async () => {
    const user = userEvent.setup();
    const { onClearAll, onDelete } = renderList(twoDocs());
    await user.click(clearAllButton());
    const d = dialog();
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(d).toHaveAccessibleName(expect.stringMatching(/clear/i));
    expect(within(d).getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming calls onClearAll once and closes the dialog", async () => {
    const user = userEvent.setup();
    const { onClearAll, onDelete } = renderList(twoDocs());
    await user.click(clearAllButton());
    await user.click(within(dialog()).getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling closes the dialog and keeps every document", async () => {
    const user = userEvent.setup();
    const { onClearAll, onDelete } = renderList(twoDocs());
    await user.click(clearAllButton());
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^First doc/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Second doc/ })).toBeInTheDocument();
    expect(clearAllButton()).toHaveFocus();
  });

  it("the dialog's Close button also cancels", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(twoDocs());
    await user.click(clearAllButton());
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("is keyboard accessible: focus moves into the dialog and Escape closes it", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(twoDocs());
    clearAllButton().focus();
    await user.keyboard("{Enter}");
    const d = dialog();
    expect(d).toContainElement(document.activeElement as HTMLElement);

    // Focus stays trapped inside while tabbing around.
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(d).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(clearAllButton()).toHaveFocus();
  });

  it("can be confirmed with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(twoDocs());
    clearAllButton().focus();
    await user.keyboard(" ");
    const confirm = within(dialog()).getByRole("button", { name: "Clear all" });
    for (let i = 0; i < 6 && document.activeElement !== confirm; i++) await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can be reopened after cancelling", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(twoDocs());
    await user.click(clearAllButton());
    await user.keyboard("{Escape}");
    await user.click(clearAllButton());
    expect(dialog()).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
