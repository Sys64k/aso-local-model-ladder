import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";


export function Footer({ version = APP_VERSION }: { version?: string }) {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (typeof fetch !== "function" || typeof window === "undefined") {
      return;
    }
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((res) => res.ok)
      .then(setOnline)
      .catch(() => setOnline(false));
    return () => controller.abort();
  }, []);
  const statusText = online ? "Online" : "Offline";
  const label = version === "dev" ? "dev" : `v${version}`;
  return (
    <footer className="border-t-2 border-fg bg-surface text-fg">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <p className="text-base">
          ReadAloud <span data-testid="app-version">{label}</span> ({statusText})
        </p>
      </div>
    </footer>
  );
}
