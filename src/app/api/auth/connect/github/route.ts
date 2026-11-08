import { connection } from "next/server";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { authorizeGitHubConnection, clearConnection, ENRICHMENT_RETURN } from "@/server/profile/connection";

export async function GET(req: Request) {
  await connection();
  if (!config.profileEnrichmentEnabled || config.fakeApi) return new Response(null, { status: 404 });
  try {
    const url = await authorizeGitHubConnection(() => signIn("github", { redirect: false, redirectTo: ENRICHMENT_RETURN }));
    return Response.redirect(url, 303);
  } catch {
    await clearConnection();
    return Response.redirect(new URL(`${ENRICHMENT_RETURN}?enrichmentError=github_reconnect`, req.url), 303);
  }
}