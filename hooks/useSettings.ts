"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type ReaderSettings,
} from "@/lib/settings";

export interface UseSettingsResult {
  settings: ReaderSettings;
  update: (partial: Partial<ReaderSettings>) => void;
  reset: () => void;
}

/**
 * Reader settings persisted in localStorage. The first render (including the
 * server render) uses the defaults; stored settings are loaded after mount and
 * saved whenever they change.
 *
 * @param storage optional Storage to use instead of window.localStorage (tests).
 */
export function useSettings(storage?: Storage): UseSettingsResult {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(loadSettings(storage));
    setLoaded(true);
  }, [storage]);

  useEffect(() => {
    // Don't overwrite stored settings with the defaults before they were loaded.
    if (!loaded) return;
    saveSettings(settings, storage);
  }, [settings, loaded, storage]);

  const update = useCallback((partial: Partial<ReaderSettings>) => {
    setSettings((prev) => sanitizeSettings({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, update, reset };
}
