import { connection } from "next/server";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { authorizeGitHubConnection, clearConnection, ENRICHMENT_RETURN } from "@/server/profile/connection";

export async function GET(req: Request) {
  await connection();
  if (!config.profileEnrichmentEnabled || config.fakeApi) return new Response(null, { status: 404 });
  try {
    const url = await authorizeGitHubConnection(() => signIn("github", { redirect: false, redirectTo: ENRICHMENT_RETURN }));
    return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch (error) {
    await clearConnection();
    const code = error && typeof error === "object" && "code" in error && error.code === "github_reconnect" ? "github_reconnect" : "provider_down";
    return new Response(null, { status: 303, headers: { Location: new URL(`${ENRICHMENT_RETURN}?enrichmentError=${code}`, req.url).toString(), "Cache-Control": "no-store" } });
  }
}
