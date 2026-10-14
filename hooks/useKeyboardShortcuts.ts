"use client";

import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  togglePlay?: () => void;
  stop?: () => void;
  next?: () => void;
  previous?: () => void;
  first?: () => void;
  last?: () => void;
  textLarger?: () => void;
  textSmaller?: () => void;
  speedUp?: () => void;
  speedDown?: () => void;
  toggleFocusView?: () => void;
  cycleTheme?: () => void;
  showHelp?: () => void;
}

export interface ShortcutInfo {
  /** Keys as shown to the user. */
  keys: string[];
  description: string;
}

/** Shown in the "Keyboard shortcuts" dialog. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { keys: ["Space", "K"], description: "Play or pause" },
  { keys: ["Escape"], description: "Stop (or close a dialog)" },
  { keys: ["Right arrow", "L"], description: "Next sentence" },
  { keys: ["Left arrow", "J"], description: "Previous sentence" },
  { keys: ["Home"], description: "First sentence" },
  { keys: ["End"], description: "Last sentence" },
  { keys: ["+", "="], description: "Larger text" },
  { keys: ["-"], description: "Smaller text" },
  { keys: ["]"], description: "Faster reading speed" },
  { keys: ["["], description: "Slower reading speed" },
  { keys: ["F"], description: "Turn focus view on or off" },
  { keys: ["T"], description: "Next theme" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
];

/** Map a KeyboardEvent.key to a handler name. */
function actionFor(key: string): keyof ShortcutHandlers | null {
  switch (key) {
    case " ":
    case "Spacebar":
    case "k":
    case "K":
      return "togglePlay";
    case "Escape":
    case "Esc":
      return "stop";
    case "ArrowRight":
    case "l":
    case "L":
      return "next";
    case "ArrowLeft":
    case "j":
    case "J":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "+":
    case "=":
      return "textLarger";
    case "-":
      return "textSmaller";
    case "]":
      return "speedUp";
    case "[":
      return "speedDown";
    case "f":
    case "F":
      return "toggleFocusView";
    case "t":
    case "T":
      return "cycleTheme";
    case "?":
      return "showHelp";
    default:
      return null;
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute("contenteditable");
  if (ce !== null && ce !== "false") return true;
  return Boolean(el.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

/** Elements that natively react to Space/Enter. */
function isActivatable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  return Boolean(
    el.closest("button, a[href], summary, [role='button'], [role='tab'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='menuitem'], [role='option']"),
  );
}

export function isDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector("dialog[open], [role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']") !== null;
}

/**
 * Global reader keyboard shortcuts. Ignored while typing in a form field, while
 * a modal dialog is open (the dialog handles Escape itself), with Ctrl/Alt/Meta,
 * and for keys another handler already handled (defaultPrevented). Handlers that
 * are undefined are not active and leave the key's default behaviour alone.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const action = actionFor(e.key);
      if (!action) return;
      if (isDialogOpen()) return;
      const target = (e.target instanceof Element ? e.target : null) ?? document.activeElement;
      // Escape still stops playback from a form field (e.g. the speed slider).
      if (action !== "stop" && isTypingTarget(target)) return;
      if (action === "togglePlay" && e.key !== "k" && e.key !== "K" && isActivatable(target)) {
        // Let Space activate the focused button instead.
        return;
      }
      const handler = ref.current[action];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
