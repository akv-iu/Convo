/**
 * The real API (B2). Each handler starts as notImplemented and is replaced
 * step by step; the contract tests say when it matches the fake.
 */
import type { Api } from "@/contracts/routes";
import { notImplemented } from "@/server/api";
import { getProfile, updateProfile, getAvailability, saveAvailability } from "@/server/profile/service";
import { searchWorkplaces } from "@/server/profile/ror";
import { createAsk, matchAsk } from "@/server/requests/asks";
import { rejectPerson, setSoftBlocker } from "@/server/requests/rejections";

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
  sendRequest: notImplemented("B2: requests table"),
  inbox: notImplemented("B2: requests for the receiver"),
  respond: notImplemented("B2: accept, decline, reply"),
  slots: notImplemented("B2: findSlots over both people's free times"),
  schedule: notImplemented("B2: book the slot"),
  resolve: notImplemented("B2: mark the ask resolved"),
  lookingForMe: notImplemented("B2: search.whoIsLookingFor count"),
};
