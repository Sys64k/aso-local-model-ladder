"use client";

import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden]") && !el.hasAttribute("inert"),
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Element to focus when the dialog closes (default: whatever had focus when it opened). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Optional id for the dialog element. */
  id?: string;
  /** If provided, this element should receive focus when the dialog closes, even if it's not the previously focused element. */
  returnFocusOverride?: HTMLElement | null;
}

/**
 * Modal dialog: role="dialog" + aria-modal, focus moves inside on open and is
 * trapped (Tab / Shift+Tab wrap), Escape closes, focus returns on close.
 * Render the rest of the page with `inert` while it is open.
 */
export function Modal({ open, onClose, title, children, returnFocusRef, id, returnFocusOverride }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef(returnFocusRef);
  const overrideRef = useRef(returnFocusOverride);
  const previousFocus = useRef<HTMLElement | null>(null);
  const openRef = useRef<boolean>(false);

  useEffect(() => {
    openRef.current = open;
    if (open) {
      // Store the currently focused element before opening the modal
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        previousFocus.current = document.activeElement;
      }
    }
    returnRef.current = returnFocusRef;
  }, [open, returnFocusRef]);

  useEffect(() => {
    overrideRef.current = returnFocusOverride;
  }, [returnFocusOverride]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (node) {
      const first = focusableIn(node)[0];
      (first ?? node).focus();
    }
    return () => {
      // Try to restore focus to the element that was focused before opening
      if (previousFocus.current?.isConnected) {
        previousFocus.current.focus();
        return;
      }

      // Fallback: try returnFocusRef
      if (returnFocusRef?.current?.isConnected) {
        returnFocusRef.current.focus();
        return;
      }

      // Fallback: try returnFocusOverride
      if (overrideRef.current?.isConnected) {
        overrideRef.current.focus();
        return;
      }

      // Last resort: try to focus on main element
      const main = document.querySelector('main');
      if (main?.isConnected) {
        main.focus();
      }
    };
  }, [open, returnFocusRef, returnFocusOverride]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const node = dialogRef.current;
    if (!node) return;
    const items = focusableIn(node);
    if (items.length === 0) {
      e.preventDefault();
      node.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === node)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div
        ref={dialogRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-2xl rounded-xl border-2 border-fg bg-bg p-6 text-fg shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 min-w-12 rounded-lg border-2 border-fg px-4 text-lg font-bold"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
