import { connection } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/server/config";
import { clearConnection, LINK_COOKIE } from "@/server/profile/connection";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";

export async function GET(req: Request) {
  await connection();
  if (!config.profileEnrichmentEnabled) return new Response(null, { status: 404 });
  const connecting = !!(await cookies()).get(LINK_COOKIE)?.value;
  await clearConnection();
  const cancelled = new URL(req.url).searchParams.get("error") === "AccessDenied";
  const code = cancelled ? connecting ? "github_connect_cancelled" : "sign_in_cancelled" : "provider_down";
  return new Response(null, { status: 303, headers: { Location: new URL(`${ENRICHMENT_RETURN_PATH}?reason=${code}`, req.url).toString(), "Cache-Control": "no-store" } });
}
