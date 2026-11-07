import { connection } from "next/server";
import { checkHealth } from "../../../../db/health";

// Operational endpoint for Dash0, deliberately outside the application API contract.
export async function GET() {
  await connection();
  const health = await checkHealth();
  return Response.json(health, {
    status: health.status === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
