import { connection } from "next/server";
import { signIn } from "@/server/auth";
import { config } from "@/server/config";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";
import { authorizeGitHubConnection, clearConnection } from "@/server/profile/connection";

export async function GET(req: Request) {
  await connection();
  if (!config.profileEnrichmentEnabled || config.fakeApi) return new Response(null, { status: 404 });
  const attemptToken = new URL(req.url).searchParams.get("token");
  if (!attemptToken) return new Response(null, { status: 404 });
  try {
    const url = await authorizeGitHubConnection(() => signIn("github", { redirect: false, redirectTo: ENRICHMENT_RETURN_PATH }), attemptToken);
    return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    await clearConnection();
    const code = error && typeof error === "object" && "code" in error && error.code === "github_reconnect" ? "github_reconnect" : "provider_down";
    return new Response(null, { status: 303, headers: { Location: new URL(`${ENRICHMENT_RETURN_PATH}?reason=${code}`, req.url).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
}
