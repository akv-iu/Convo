import { EnrichmentReason } from "@/contracts/enrichment";
import { approvedSnapshot, type ApprovedEvidence } from "../evidence";
import { collectGitHubEvidence } from "./github";
import { collectResearchPapers } from "./openalex";
import { collectPublicProfile } from "./public-profile";
import { professionalCv, sanitizeEvidence } from "./professional-text";
import { claimJob, failJob, finishDraft, recordCollection } from "./state";
import { enrichmentError, StateError } from "./model";
import { synthesize } from "./synthesis";

export type RunContext = { github?: { accountId: string; accessToken: string }; openAlexApiKey?: string; fakeAi?: boolean };

/** Internal only: context is server-owned and must never be stored in the job or returned to the client. */
export async function runEnrichment(owner: string, id: string, context: RunContext): Promise<void> {
  let lease: Awaited<ReturnType<typeof claimJob>>;
  try { lease = await claimJob(owner, id); }
  catch (error) {
    if (error instanceof StateError && ["running", "draft_superseded"].includes(error.code)) return;
    throw error;
  }
  try {
    const results = await Promise.all(lease.value.sources.map(async source => {
      if (source.status !== "running") return { source, docs: lease.collected.filter(e => e.source === source.source) };
      try {
        let docs: ApprovedEvidence[] = [];
        if (source.source === "github") {
          const result = await collectGitHubEvidence(owner, context.github?.accountId ?? null, context.github?.accessToken, lease.input.github);
          docs = result.evidence; source = { ...source, github: result.github, ...(result.reason ? { reason: result.reason } : {}) };
        } else if (source.source === "research") {
          if (!context.openAlexApiKey) enrichmentError("provider_down", 503);
          const chosen = lease.input.research;
          if (!chosen || "skip" in chosen) enrichmentError("selection_stale");
          docs = await collectResearchPapers(owner, chosen.candidateId, context.openAlexApiKey);
        } else if (source.source === "public_profile") {
          const chosen = lease.input.publicProfile;
          if (!chosen || "skip" in chosen) enrichmentError("selection_stale");
          const choice = "candidateId" in chosen ? { url: source.selection?.url ?? "" } : chosen;
          docs = [await collectPublicProfile(owner, choice)];
        } else {
          if (lease.cvText === null) enrichmentError("cv_expired");
          docs = professionalCv(owner, lease.cvText);
        }
        docs = sanitizeEvidence(docs);
        if (docs.some(doc => doc.source !== source.source || doc.sourceId !== source.sourceId)) enrichmentError("provider_down", 503);
        approvedSnapshot({ id: owner, githubLogin: null, createdAt: new Date(), githubEvidence: [], profileEvidence: docs });
        return { source: { ...source, status: docs.length ? "done" as const : "empty" as const, items: docs.length }, docs };
      } catch (error) {
        const reason = error instanceof StateError ? EnrichmentReason.safeParse(error.code).data ?? "provider_down" : "provider_down";
        return { source: { ...source, status: "failed" as const, reason, items: 0,
          ...(error instanceof StateError && error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, docs: [] };
      }
    }));
    const docs = results.flatMap(result => result.docs);
    await recordCollection(owner, id, lease.token, results.map(result => result.source), docs);
    const proposal = !docs.length ? { bio: "", bioEvidenceIds: [], expertise: [] }
      : context.fakeAi ? { bio: "Professional work is supported by the selected evidence.", bioEvidenceIds: [docs[0].id], expertise: [] }
      : await synthesize(owner, id, lease.token, lease.value.selectionGeneration, docs, lease.input.identity);
    await finishDraft(owner, id, lease.token, proposal);
  } catch {
    // A cancelled/expired worker cannot write a failure over its replacement either.
    await failJob(owner, id, lease.token, "provider_down").catch(() => undefined);
  }
}
