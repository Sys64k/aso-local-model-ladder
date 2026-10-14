"use client";

import { Fragment, type RefObject } from "react";
import { SHORTCUTS } from "@/hooks/useKeyboardShortcuts";
import { Modal } from "./Modal";

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ShortcutsDialog({ open, onClose, returnFocusRef }: ShortcutsDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" returnFocusRef={returnFocusRef}>
      <p className="mb-4 text-lg">
        Shortcuts work anywhere on the page except while you are typing in a text box or a
        dialog is open.
      </p>
      <table className="w-full border-collapse text-left text-lg">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <thead>
          <tr className="border-b-2 border-fg">
            <th scope="col" className="py-2 pr-4">
              Key
            </th>
            <th scope="col" className="py-2">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.description} className="border-b border-fg/40">
              <td className="py-2 pr-4 whitespace-nowrap">
                {s.keys.map((k, i) => (
                  <Fragment key={k}>
                    {i > 0 && <span className="px-1">or</span>}
                    <kbd className="rounded border-2 border-fg bg-surface px-2 py-0.5 font-mono">
                      {k}
                    </kbd>
                  </Fragment>
                ))}
              </td>
              <td className="py-2">{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
