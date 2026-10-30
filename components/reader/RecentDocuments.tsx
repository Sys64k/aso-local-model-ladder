"use client";

import { type Ref, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { notePreview, type DocumentSource, type SavedDocument } from "@/lib/documents";

export const RECENT_SECTION_ID = "recent-section";

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
  onClearAll: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function RecentDocuments({ documents, onOpen, onDelete, onClearAll, headingRef }: RecentDocumentsProps) {
  const [showDialog, setShowDialog] = useState(false);
  const clearAllRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLSectionElement>(null);

  return (
    <section id={RECENT_SECTION_ID} aria-labelledby="recent-heading" className="space-y-4" ref={sectionRef}>
      <div className="flex items-center justify-between">
        <h2 id="recent-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          Recent documents
        </h2>
        {documents.length > 0 && (
          <button
            ref={clearAllRef}
            type="button"
            onClick={() => setShowDialog(true)}
            className="min-h-12 min-w-0 rounded-lg border-2 border-fg bg-surface px-4 text-lg hover:bg-fg hover:text-bg"
          >
            Clear all
          </button>
        )}
      </div>
      {documents.length === 0 ? (
        <p
          tabIndex={0}
          role="region"
          aria-live="polite"
        >
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
      <Modal
        open={showDialog}
        onClose={() => setShowDialog(false)}
        title="Clear all recent documents?"
        returnFocusRef={sectionRef}
      >
        <div className="flex flex-col gap-6">
          <p className="text-lg">
            Are you sure you want to remove all saved documents? This cannot be undone.
          </p>
          <div className="flex justify-end gap-4">
            <button
              type="button"
              id="clear-confirm-button"
              onClick={() => {
                onClearAll();
                setShowDialog(false);
              }}
              className="min-h-12 min-w-0 rounded-lg border-2 border-fg bg-fg px-6 text-lg font-bold text-bg hover:bg-white/10"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setShowDialog(false)}
              className="min-h-12 min-w-12 rounded-lg border-2 border-fg px-4 text-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}