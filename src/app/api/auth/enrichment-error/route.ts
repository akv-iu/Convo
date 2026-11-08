import { connection } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/server/config";
import { clearConnection, ENRICHMENT_RETURN, LINK_COOKIE } from "@/server/profile/connection";

export async function GET(req: Request) {
  await connection();
  if (!config.profileEnrichmentEnabled) return new Response(null, { status: 404 });
  const connecting = !!(await cookies()).get(LINK_COOKIE)?.value;
  await clearConnection();
  const cancelled = new URL(req.url).searchParams.get("error") === "AccessDenied";
  const code = cancelled ? connecting ? "github_connect_cancelled" : "sign_in_cancelled" : "provider_down";
  return Response.redirect(new URL(`${ENRICHMENT_RETURN}?enrichmentError=${code}`, req.url), 303);
}