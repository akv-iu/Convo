/**
 * The real API (B2). Each handler starts as notImplemented and is replaced
 * step by step; the contract tests say when it matches the fake.
 */
import type { Api } from "@/contracts/routes";
import { notImplemented } from "@/server/api";

export const real: Api = {
  getMe: notImplemented("B2: profile from Postgres"),
  putMe: notImplemented("B2: save profile, re-ingest to Elasticsearch"),
  searchRor: notImplemented("B2: ROR lookup"),
  getAvailability: notImplemented("B2: free times from Postgres"),
  putAvailability: notImplemented("B2: save free times, update Elasticsearch"),
  refine: notImplemented("B2: create ask, call ai.refineAsk, search.registerAsk"),
  match: notImplemented("B2: load ask and exclusions, call runMatch"),
  reject: notImplemented("B2: rejections table, batch-reject rule"),
  setSoftBlocker: notImplemented("B2: soft blocker flag on the ask"),
  sendRequest: notImplemented("B2: requests table"),
  inbox: notImplemented("B2: requests for the receiver"),
  respond: notImplemented("B2: accept, decline, reply"),
  slots: notImplemented("B2: findSlots over both people's free times"),
  schedule: notImplemented("B2: book the slot"),
  resolve: notImplemented("B2: mark the ask resolved"),
  lookingForMe: notImplemented("B2: search.whoIsLookingFor count"),
};
