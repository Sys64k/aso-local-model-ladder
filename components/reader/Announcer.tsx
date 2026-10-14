"use client";

import { useCallback, useState } from "react";

/**
 * Visually hidden polite live region for short status messages ("Playing",
 * "Text size 32"). Never put the text being read aloud in here: it would talk
 * over the speech.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <div id="announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

/** State for <Announcer>. Repeating the same message still changes the DOM so it is re-announced. */
export function useAnnouncer(): [string, (message: string) => void] {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => {
    setMessage((prev) => (prev === next ? `${next}\u00A0` : next));
  }, []);
  return [message, announce];
}
