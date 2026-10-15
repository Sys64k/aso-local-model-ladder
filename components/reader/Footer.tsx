import { APP_VERSION } from "@/lib/version";

export function Footer({ version = APP_VERSION }: { version?: string }) {
  const label = version === "dev" ? "dev" : `v${version}`;
  return (
    <footer className="border-t-2 border-fg bg-surface text-fg">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <p className="text-base">
          ReadAloud <span data-testid="app-version">{label}</span>
        </p>
      </div>
    </footer>
  );
}
