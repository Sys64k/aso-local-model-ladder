/**
 * Returns window.localStorage when it is available and accessible, otherwise
 * null. Accessing localStorage can throw (e.g. blocked cookies, some private
 * modes), and it does not exist during server rendering.
 */
export function getDefaultStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
