/**
 * The real API (B2). Each handler starts as notImplemented and is replaced
 * step by step; the contract tests say when it matches the fake.
 */
import type { Api } from "@/contracts/routes";
import { getProfile, updateProfile, getAvailability, saveAvailability } from "@/server/profile/service";
import { searchWorkplaces } from "@/server/profile/ror";
import { createAsk, getAsk, matchAsk } from "@/server/requests/asks";
import { rejectPerson, setSoftBlocker } from "@/server/requests/rejections";
import { sendRequest, getInbox, getSentRequests, respondToRequest } from "@/server/requests/messages";
import { getSlots, bookSlot } from "@/server/schedule/service";
import { lookingForMe, resolveAsk } from "@/server/requests/lifecycle";

export const real: Api = {
  getMe: ({ userId }) => getProfile(userId),
  putMe: ({ userId, body }) => updateProfile(userId, body),
  searchRor: ({ query }) => searchWorkplaces(query.get("q") ?? ""),
  getAvailability: ({ userId }) => getAvailability(userId),
  putAvailability: ({ userId, body }) => saveAvailability(userId, body),
  refine: ({ userId, body }) => createAsk(userId, body.text),
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
