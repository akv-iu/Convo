import type { RouteBody } from "@/contracts/routes";
import { accountState } from "../connection";
import { readAccountState } from "../identities";
import { findStartJob, getJob, prepareJob, prepareRetry, readPrivateState, saveIdentity } from "./state";
import { readUser } from "../service";
import { loadGitHubConnection, needsGitHub, scheduleEnrichment } from "./execution";

export async function getEnrichment(owner: string, id: string) {
  return getJob(owner, id, (await readUser(owner)).textVersion);
}
export async function retryEnrichment(owner: string, id: string) {
  const user = await readUser(owner);
  const previous = await getJob(owner, id, user.textVersion);
  const github = needsGitHub(previous) ? await loadGitHubConnection(owner) : undefined;
  const { job, attempt } = await prepareRetry(owner, id, user.textVersion);
  scheduleEnrichment(owner, job, github, attempt);
  return job;
}

export async function enrichmentState(owner: string) {
  const [account, staged] = await Promise.all([readAccountState(owner, await accountState(owner)), readPrivateState(owner)]);
  return { ...account, ...staged };
}
export async function saveEnrichmentIdentity(owner: string, input: RouteBody<"saveEnrichmentIdentity">) {
  const staged = await saveIdentity(owner, input);
  return { ...await readAccountState(owner, await accountState(owner)), ...staged };
}
export async function startEnrichment(owner: string, input: RouteBody<"startEnrichment">) {
  const user = await readUser(owner);
  const replay = await findStartJob(owner, input);
  const initial = !replay && input.github.import ? await loadGitHubConnection(owner) : undefined;
  const { job, attempt } = await prepareJob(owner, input, initial ? user.githubLogin : null, user.textVersion);
  const github = job.state === "queued" && needsGitHub(job) ? initial ?? await loadGitHubConnection(owner) : undefined;
  scheduleEnrichment(owner, job, github, attempt);
  return job;
}
