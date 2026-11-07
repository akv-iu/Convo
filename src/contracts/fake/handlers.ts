/**
 * The fake API: one handler per route in the contract, answering from memory.
 * A's screens run against this with FAKE_API=1. The contract tests run the
 * same checks against these and, once built, against the real handlers.
 */
import * as fixtures from "@/contracts/fixtures";
import { routes, type Api } from "@/contracts/routes";
import { ai } from "@/server/ai";
import { config } from "@/server/config";
import { runMatch } from "@/server/pipeline";
import { findSlots } from "@/server/schedule/slots";
import { search } from "@/server/search";
import { Forbidden, store } from "./store";
import type { Request, RequestView } from "@/contracts/types";
import { visibleCard, visiblePerson } from "@/server/profile/visibility";
import { enrichmentFake, noteProfileChange } from "./enrichment";

const now = () => new Date().toISOString();

/** A request with the other person's badge (their show/hide choices applied) and the ask's type. */
function withBadge(request: Request, otherId: string): RequestView {
  const other = store.get().people.get(otherId);
  return {
    ...request,
    type: store.get().asks.get(request.askId)?.refined?.type ?? null,
    person: other ? visiblePerson(other) : null,
  };
}

export const fake: Api = {
  ...enrichmentFake,
  async getMe({ userId }) {
    return store.person(userId);
  },

  async putMe({ userId, body }) {
    const me = store.person(userId);
    const patch = routes.putMe.body.parse(body);
    const updated = {
      ...me, ...patch, id: me.id, synthetic: me.synthetic,
      ...(patch.filters && patch.workplaceName === undefined && patch.filters.rorId !== me.filters.rorId ? { workplaceName: null } : {}),
    };
    store.get().people.set(userId, updated);
    noteProfileChange(userId, patch.bio !== undefined && patch.bio !== me.bio);
    await search.ingestPerson(updated, store.get().enrichment.evidence.get(userId) ?? []);
    return updated;
  },

  async searchRor({ query }) {
    const q = (query.get("q") ?? "").toLowerCase().trim();
    if (!q) return [];
    return fixtures.ror.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 8);
  },

  async getAvailability({ userId }) {
    return store.person(userId).freeTimes;
  },

  async putAvailability({ userId, body }) {
    const me = store.person(userId);
    me.freeTimes = body;
    noteProfileChange(userId);
    return me.freeTimes;
  },

  async refine({ userId, body }) {
    const me = store.person(userId);
    const refined = await ai.refineAsk(body.text, me);
    const id = crypto.randomUUID();
    store.get().asks.set(id, {
      id,
      userId,
      rawText: body.text,
      refined,
      status: "open",
      softBlocker: true,
      createdAt: now(),
    });
    await search.registerAsk(id, userId, refined.text);
    return { askId: id, refined };
  },

  async match({ userId, body }) {
    const ask = store.ask(body.askId, userId);
    const rejected = store.get().rejections.get(ask.id) ?? [];
    const hiddenBelowRank =
      rejected.length >= config.batchRejectAfter ? Math.max(...rejected.map((r) => r.rank)) : null;
    const requested = [...store.get().requests.values()].filter((r) => r.askId === ask.id).map((r) => r.toPersonId);
    const matches = await runMatch({
      ask,
      requester: store.person(userId),
      excludeIds: [],
      // Ranked, then left out, so everyone else keeps their rank (same as the real API).
      hideIds: [...(ask.softBlocker ? rejected.map((r) => r.personId) : []), ...requested],
      query: body.query,
      hiddenBelowRank,
    });
    return matches.map(match => visibleCard(match, store.person(match.person.id).visibility));
  },

  async reject({ userId, body }) {
    const ask = store.ask(body.askId, userId);
    const list = store.get().rejections.get(ask.id) ?? [];
    // One rejection per person per ask: a repeat is not counted again.
    if (!list.some((r) => r.personId === body.personId)) list.push({ personId: body.personId, rank: body.rank });
    store.get().rejections.set(ask.id, list);
    const hiddenBelowRank = list.length >= config.batchRejectAfter ? Math.max(...list.map((r) => r.rank)) : null;
    return { rejections: list.length, hiddenBelowRank };
  },

  async setSoftBlocker({ userId, body }) {
    const ask = store.ask(body.askId, userId);
    ask.softBlocker = body.enabled;
    return { askId: ask.id, enabled: ask.softBlocker };
  },

  async sendRequest({ userId, body }) {
    const ask = store.ask(body.askId, userId);
    store.person(body.toPersonId);
    // One request per person per ask: a resend returns the saved one.
    const saved = [...store.get().requests.values()].find((r) => r.askId === ask.id && r.toPersonId === body.toPersonId);
    if (saved) return saved;
    const id = store.nextId("req");
    const request = {
      id,
      askId: ask.id,
      fromUserId: userId,
      toPersonId: body.toPersonId,
      question: ask.refined?.text ?? ask.rawText,
      minutes: ask.refined?.minutes ?? 10,
      status: "sent" as const,
      reply: null,
      slot: null,
      createdAt: now(),
    };
    store.get().requests.set(id, request);
    return request;
  },

  async inbox({ userId }) {
    return [...store.get().requests.values()].filter((r) => r.toPersonId === userId).reverse()
      .map((r) => withBadge(r, r.fromUserId));
  },

  async sentRequests({ userId }) {
    return [...store.get().requests.values()].filter((r) => r.fromUserId === userId).reverse()
      .map((r) => withBadge(r, r.toPersonId));
  },

  async respond({ userId, params, body }) {
    const request = store.request(params.id);
    if (request.toPersonId !== userId) throw new Forbidden("not the receiver");
    if (body.action === "accept") request.status = "accepted";
    else if (body.action === "decline") request.status = "declined";
    else {
      request.status = "answered";
      request.reply = body.reply;
    }
    return request;
  },

  async slots({ userId, params }) {
    const request = store.request(params.id);
    if (request.fromUserId !== userId && request.toPersonId !== userId) throw new Forbidden("not your request");
    return findSlots(store.person(request.fromUserId).freeTimes, store.person(request.toPersonId).freeTimes, {
      now: new Date(),
      minutes: request.minutes,
      lockoutMinutes: config.slotLockoutMinutes,
      booked: [...store.bookedFor(request.fromUserId), ...store.bookedFor(request.toPersonId)],
      max: config.maxSlots,
    });
  },

  async schedule({ userId, params, body }) {
    const request = store.request(params.id);
    if (request.fromUserId !== userId && request.toPersonId !== userId) throw new Forbidden("not your request");
    request.slot = body.slot;
    request.status = "scheduled";
    return request;
  },

  async getAsk({ userId, params }) {
    return store.ask(params.id, userId);
  },

  async resolve({ userId, params }) {
    const ask = store.ask(params.id, userId);
    ask.status = "resolved";
    await search.removeAsk(ask.id);
    return ask;
  },

  async lookingForMe({ userId }) {
    const me = store.person(userId);
    return { count: (await search.whoIsLookingFor(me)).length };
  },
};
