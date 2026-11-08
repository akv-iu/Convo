import type { RouteBody } from "@/contracts/routes";
import { accountState } from "../connection";
import { readAccountState } from "../identities";
import { enrichmentError } from "./model";
import { createJob, readPrivateState, saveIdentity } from "./state";

export async function enrichmentState(owner: string) {
  const [account, staged] = await Promise.all([readAccountState(owner, await accountState(owner)), readPrivateState(owner)]);
  return { ...account, ...staged };
}
export async function saveEnrichmentIdentity(owner: string, input: RouteBody<"saveEnrichmentIdentity">) {
  const staged = await saveIdentity(owner, input);
  return { ...await readAccountState(owner, await accountState(owner)), ...staged };
}
export async function startEnrichment(owner: string, input: RouteBody<"startEnrichment">) {
  const active = input.github.import || (input.research && !("skip" in input.research))
    || (input.publicProfile && !("skip" in input.publicProfile)) || input.cv;
  // Until the collector/synthesis runner ships, never enqueue work that cannot execute.
  if (active) enrichmentError("not_ready", 501);
  return createJob(owner, input, null);
}