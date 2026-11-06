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
import { visibleCard } from "@/server/profile/visibility";

const now = () => new Date().toISOString();

export const fake: Api = {
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
    await search.ingestPerson(updated, fixtures.evidence.filter((e) => e.personId === userId));
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
    const matches = await runMatch({
      ask,
      requester: store.person(userId),
      excludeIds: ask.softBlocker ? rejected.map((r) => r.personId) : [],
      query: body.query,
      hiddenBelowRank,
    });
    return matches.map(match => visibleCard(match, store.person(match.person.id).visibility));
  },

  async reject({ userId, body }) {
    const ask = store.ask(body.askId, userId);
    const list = store.get().rejections.get(ask.id) ?? [];
    list.push({ personId: body.personId, rank: body.rank });
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
    return [...store.get().requests.values()].filter((r) => r.toPersonId === userId).reverse();
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
