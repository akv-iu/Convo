import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import type { EnrichmentJob } from "@/contracts/enrichment";
import { config } from "@/server/config";
import { db } from "../../../../db";
import { authIdentities } from "../../../../db/schema";
import { currentToken } from "../connection";
import { enrichmentError, StateError } from "./model";
import { runEnrichment, type RunContext } from "./runner";

/** Only the encrypted cookie owner and their immutable provider subject authorize import. */
export async function loadGitHubConnection(owner: string): Promise<RunContext["github"]> {
  try {
    const token = await currentToken();
    if (token?.sub !== owner) enrichmentError("sign_in_required", 401);
    const [identity] = await db().select({ id: authIdentities.providerAccountId }).from(authIdentities)
      .where(and(eq(authIdentities.userId, owner), eq(authIdentities.provider, "github"))).limit(1);
    if (!identity) return undefined;
    if (!/^[1-9]\d*$/.test(identity.id)) enrichmentError("provider_down", 503);
    return { accountId: identity.id, accessToken: typeof token.githubToken === "string" ? token.githubToken : "" };
  } catch (error) {
    if (error instanceof StateError) throw error;
    enrichmentError("provider_down", 503);
  }
}

export const needsGitHub = (job: EnrichmentJob) => job.sources.some(source => source.source === "github"
  && !["not_selected", "done", "empty", "removed"].includes(source.status));

/** Request-only: private context stays in this closure, never in a DTO or durable job. */
export function scheduleEnrichment(owner: string, job: EnrichmentJob, github?: RunContext["github"], dispatchToken?: string): void {
  if (job.state !== "queued" || !dispatchToken) return;
  // Discovery configuration merges separately; absent credentials fail only the research source.
  const settings: { fakeAi: boolean; openAlexApiKey?: string } = config;
  const context: RunContext = { fakeAi: settings.fakeAi, openAlexApiKey: settings.openAlexApiKey, dispatchToken,
    ...(needsGitHub(job) && github ? { github: { ...github } } : {}) };
  try {
    after(() => runEnrichment(owner, job.jobId, context).catch(() => {
      console.warn("[profile-enrichment] Background import interrupted; retry after the lease expires.");
    }));
  } catch {
    // shortcut: after() is not a durable queue; an unscheduled job stalls and needs explicit retry.
    console.warn("[profile-enrichment] Import scheduling unavailable; retry after the lease expires.");
  }
}
