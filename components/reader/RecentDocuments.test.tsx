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
  const utils = render(
    <RecentDocuments
      documents={documents}
      onOpen={onOpen}
      onDelete={onDelete}
      onClearAll={onClearAll}
    />,
  );
  return { onOpen, onDelete, onClearAll, ...utils };
}

const DOCS: SavedDocument[] = [
  makeDoc({ id: "a", title: "First doc", text: "a" }),
  makeDoc({ id: "b", title: "Second doc", text: "b" }),
  makeDoc({ id: "c", title: "Third doc", text: "c" }),
];

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "Clear all" });
}

function confirmButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("button", { name: /clear all|delete all|remove all/i });
}

function cancelButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("button", { name: /^cancel$/i });
}

function expectAllListed(titles: string[]) {
  expect(screen.getAllByRole("listitem")).toHaveLength(titles.length);
  for (const title of titles) {
    expect(screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(title)}`) })).toBeInTheDocument();
  }
}

describe("RecentDocuments clear all", () => {
  it("hides the Clear all button when there are no documents", () => {
    renderList([]);
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a single Clear all button with one document", () => {
    renderList([makeDoc()]);
    expect(screen.getAllByRole("button", { name: /clear all/i })).toHaveLength(1);
    expect(trigger()).toHaveAttribute("type", "button");
  });

  it("shows a single Clear all button (not one per item) with several documents", () => {
    renderList(DOCS);
    expect(screen.getAllByRole("button", { name: /clear all/i })).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    for (const item of screen.getAllByRole("listitem")) {
      expect(within(item).queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
    }
  });

  it("hides the button again when the list becomes empty", () => {
    const { rerender, onOpen, onDelete, onClearAll } = renderList(DOCS);
    expect(trigger()).toBeInTheDocument();
    rerender(
      <RecentDocuments documents={[]} onOpen={onOpen} onDelete={onDelete} onClearAll={onClearAll} />,
    );
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
  });

  it("asks for confirmation in a dialog instead of clearing straight away", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(DOCS);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/clear|delete|remove/i);
    expect(confirmButton(dialog)).toBeInTheDocument();
    expect(cancelButton(dialog)).toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expectAllListed(["First doc", "Second doc", "Third doc"]);
  });

  it("confirming calls onClearAll once and closes the dialog", async () => {
    const user = userEvent.setup();
    const { onClearAll, onDelete, onOpen } = renderList(DOCS);
    await user.click(trigger());
    await user.click(confirmButton(screen.getByRole("dialog")));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling keeps every document, closes the dialog and returns focus", async () => {
    const user = userEvent.setup();
    const { onClearAll, onDelete } = renderList(DOCS);
    const button = trigger();
    await user.click(button);
    await user.click(cancelButton(screen.getByRole("dialog")));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expectAllListed(["First doc", "Second doc", "Third doc"]);
    expect(button).toHaveFocus();
  });

  it("the dialog's Close button also cancels", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(DOCS);
    await user.click(trigger());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expectAllListed(["First doc", "Second doc", "Third doc"]);
  });

  it("can be reopened after cancelling and then confirmed", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(DOCS);
    await user.click(trigger());
    await user.click(cancelButton(screen.getByRole("dialog")));
    await user.click(trigger());
    await user.click(confirmButton(screen.getByRole("dialog")));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("is keyboard accessible: focus moves into the dialog and Escape closes it", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(DOCS);
    const button = trigger();
    button.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClearAll).not.toHaveBeenCalled();
    expectAllListed(["First doc", "Second doc", "Third doc"]);
    expect(button).toHaveFocus();
  });

  it("can be confirmed with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { onClearAll } = renderList(DOCS);
    trigger().focus();
    await user.keyboard(" ");
    const dialog = screen.getByRole("dialog");
    const confirm = confirmButton(dialog);
    for (let i = 0; i < 6 && document.activeElement !== confirm; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    expect(confirm).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

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
