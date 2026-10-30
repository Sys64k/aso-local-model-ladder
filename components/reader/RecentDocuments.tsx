"use client";

import { clearDocuments } from "@/lib/documents";
import { type Ref } from "react";
import { Modal } from "./Modal";
import { notePreview, type DocumentSource, type SavedDocument } from "@/lib/documents";
import { useState } from "react";

export const SOURCE_LABELS: Record<DocumentSource, string> = {
  paste: "Pasted text",
  file: "Text file",
  pdf: "PDF",
  image: "Photo or image",
  url: "Web page",
};

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Date(ms).toDateString();
  }
}

export interface RecentDocumentsProps {
  documents: SavedDocument[];
  onOpen: (doc: SavedDocument) => void;
  onDelete: (doc: SavedDocument) => void;
  onClear: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function RecentDocuments({ documents, onOpen, onDelete, onClear, headingRef }: RecentDocumentsProps) {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  return (
    <section aria-labelledby="recent-heading" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 id="recent-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          Recent documents
        </h2>
        {documents.length > 0 && (
          <button
            type="button"
            onClick={() => setIsClearDialogOpen(true)}
            className="min-h-10 min-w-10 rounded-lg border-2 border-fg px-2 text-sm text-muted hover:text-fg hover:border-fg"
          >
            Clear all
          </button>
        )}
      </div>
      <Modal
        open={isClearDialogOpen}
        onClose={() => setIsClearDialogOpen(false)}
        title="Clear recent documents?"
      >
        <p className="text-lg">
          This will remove all saved documents from recent documents and storage. This action cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setIsClearDialogOpen(false)}
            className="min-h-10 min-w-20 rounded-lg border-2 border-fg px-4 text-lg font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClear();
              setIsClearDialogOpen(false);
            }}
            className="min-h-10 min-w-20 rounded-lg border-2 border-fg px-4 text-lg font-bold"
          >
            Clear
          </button>
        </div>
      </Modal>
      {documents.length === 0 ? (
        <p className="text-lg text-muted">
          Nothing here yet. Documents you read will appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {documents.map((doc) => {
            const preview = notePreview(doc.note);
            return (
            <li
              key={doc.id}
              className="flex flex-wrap items-stretch gap-2 rounded-xl border-2 border-fg bg-surface p-2"
            >
              <button
                type="button"
                onClick={() => onOpen(doc)}
                className="flex min-h-12 min-w-0 flex-1 flex-col items-start rounded-lg px-3 py-2 text-left text-lg"
              >
                <span className="font-bold break-words">{doc.title}</span>{" "}
                <span className="text-base text-muted">
                  {SOURCE_LABELS[doc.source]} · {formatDate(doc.updatedAt)}
                </span>
                {preview ? (
                  <>
                    {" "}
                    <span data-testid="note-preview" className="text-base text-fg break-words">
                      Note: {preview}
                    </span>
                  </>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Delete ${doc.title}`}
                onClick={() => onDelete(doc)}
                className="min-h-12 min-w-12 self-center rounded-lg border-2 border-fg px-4 text-lg"
              >
                Delete
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
