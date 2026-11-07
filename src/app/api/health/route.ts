import { checkHealth } from "../../../../db/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operational endpoint for Dash0, deliberately outside the application API contract.
export async function GET() {
  const health = await checkHealth();
  return Response.json(health, {
    status: health.status === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
