/**
 * The real API (B2). Each handler starts as notImplemented and is replaced
 * step by step; the contract tests say when it matches the fake.
 */
import type { Api } from "@/contracts/routes";
import { getProfile, updateProfile, getAvailability, saveAvailability } from "@/server/profile/service";
import { searchWorkplaces } from "@/server/profile/ror";
import { getContact, saveContact } from "@/server/profile/contact";
import { createAsk, getAsk, matchAsk, previewAsk, saveAskAsWritten } from "@/server/requests/asks";
import { rejectPerson, setSoftBlocker } from "@/server/requests/rejections";
import { sendRequest, getInbox, getSentRequests, respondToRequest } from "@/server/requests/messages";
import { getSlots, bookSlot } from "@/server/schedule/service";
import { lookingForMe, resolveAsk } from "@/server/requests/lifecycle";
import { beginGitHubConnection } from "@/server/profile/connection";
import { enrichmentState, saveEnrichmentIdentity, startEnrichment, getEnrichment, retryEnrichment } from "@/server/profile/enrichment/service";
import { cancelJob, removeCv, stageCvText } from "@/server/profile/enrichment/state";
import { acceptEnrichment, enrichmentSources, removeEnrichmentSource } from "@/server/profile/enrichment/approval";
import { discoverEnrichment } from "@/server/profile/enrichment/discovery";
import { config } from "@/server/config";

export const real: Api = {
  enrichmentState: ({ userId }) => enrichmentState(userId),
  saveEnrichmentIdentity: ({ userId, body }) => saveEnrichmentIdentity(userId, body),
  connectGitHub: ({ userId }) => beginGitHubConnection(userId),
  discoverEnrichment: ({ userId, body }) => discoverEnrichment(userId, body, {
    openAlexApiKey: config.openAlexApiKey, braveSearchApiKey: config.braveSearchApiKey,
  }),
  uploadCv: ({ userId, body }) => stageCvText(userId, body),
  removeCv: ({ userId, params }) => removeCv(userId, params.id),
  startEnrichment: ({ userId, body }) => startEnrichment(userId, body),
  getEnrichment: ({ userId, params }) => getEnrichment(userId, params.id),
  retryEnrichment: ({ userId, params }) => retryEnrichment(userId, params.id),
  acceptEnrichment: ({ userId, params, body }) => acceptEnrichment(userId, params.id, body),
  cancelEnrichment: ({ userId, params }) => cancelJob(userId, params.id),
  enrichmentSources: ({ userId }) => enrichmentSources(userId),
  removeEnrichmentSource: ({ userId, params }) => removeEnrichmentSource(userId, params.id),
  getMe: ({ userId }) => getProfile(userId),
  putMe: ({ userId, body }) => updateProfile(userId, body),
  getContact: ({ userId }) => getContact(userId),
  putContact: ({ userId, body }) => saveContact(userId, body),
  searchRor: ({ query }) => searchWorkplaces(query.get("q") ?? ""),
  getAvailability: ({ userId }) => getAvailability(userId),
  putAvailability: ({ userId, body }) => saveAvailability(userId, body),
  refine: ({ userId, body }) => createAsk(userId, body.text),
  previewRefine: ({ userId, body }) => previewAsk(userId, body.text),
  saveAsk: ({ userId, body }) => saveAskAsWritten(userId, body),
  match: ({ userId, body }) => matchAsk(userId, body.askId, body.query),
  reject: ({ userId, body }) => rejectPerson(userId, body),
  setSoftBlocker: ({ userId, body }) => setSoftBlocker(userId, body),
  sendRequest: ({ userId, body }) => sendRequest(userId, body),
  inbox: ({ userId }) => getInbox(userId),
  sentRequests: ({ userId }) => getSentRequests(userId),
  respond: ({ userId, params, body }) => respondToRequest(userId, params.id, body),
  slots: ({ userId, params }) => getSlots(userId, params.id),
  schedule: ({ userId, params, body }) => bookSlot(userId, params.id, body.slot),
  getAsk: ({ userId, params }) => getAsk(userId, params.id),
  resolve: ({ userId, params }) => resolveAsk(userId, params.id),
  lookingForMe: ({ userId }) => lookingForMe(userId),
};
