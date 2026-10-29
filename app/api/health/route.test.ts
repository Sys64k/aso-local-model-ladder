import { describe, expect, it } from "vitest";

import { dynamic, GET, runtime } from "./route";

describe("GET /api/health", () => {
  it("uses the nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("is never statically prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 200 with {status:'ok'} and no-store caching", async () => {
    const res = GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptimeSec");
  });
});