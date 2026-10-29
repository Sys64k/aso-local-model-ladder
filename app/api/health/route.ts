import { APP_VERSION } from "@/lib/version";
const SERVER_START = Date.now();
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe: cheap, no DB or network access. */
export function GET(): Response {
  return Response.json(
    { status: "ok", version: APP_VERSION, uptimeSec: Math.floor((Date.now() - SERVER_START)/1000) },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
