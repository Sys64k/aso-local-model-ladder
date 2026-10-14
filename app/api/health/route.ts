export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe: cheap, no DB or network access. */
export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
