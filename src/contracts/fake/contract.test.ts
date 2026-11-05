/**
 * Contract tests. They run against the fake now; when B's real handlers are
 * ready, add them to `implementations` and the same tests prove the swap
 * is safe.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, sampleAsks } from "@/contracts/fixtures";
import { routes, type Api, type Ctx, type RouteName } from "@/contracts/routes";
import { fake } from "./handlers";
import { store } from "./store";

const implementations: { name: string; api: Api; reset: () => void }[] = [
  { name: "fake", api: fake, reset: () => store.reset() },
];

function ctx<N extends RouteName>(userId: string, body?: unknown, params: Record<string, string> = {}, q = ""): Ctx<N> {
  return { userId, params, query: new URLSearchParams(q), body } as Ctx<N>;
}

describe.each(implementations)("$name API", ({ api, reset }) => {
  beforeEach(reset);

  it("every response matches the contract", async () => {
    const me = await api.getMe(ctx(DEMO_USER_A));
    expect(routes.getMe.response.parse(me)).toEqual(me);

    expect(routes.searchRor.response.parse(await api.searchRor(ctx(DEMO_USER_A, undefined, {}, "q=grafana")))).toHaveLength(1);
    expect(routes.getAvailability.response.parse(await api.getAvailability(ctx(DEMO_USER_A)))).not.toHaveLength(0);
    routes.lookingForMe.response.parse(await api.lookingForMe(ctx(DEMO_USER_B)));
  });

  it("refines every sample ask to its expected top person", async () => {
    for (const sample of sampleAsks) {
      const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sample.raw }));
      routes.refine.response.parse({ askId, refined });
      const results = await api.match(ctx(DEMO_USER_A, { askId }));
      routes.match.response.parse(results);
      expect(results[0]?.person.id, sample.raw).toBe(sample.expectedTop);
      expect(results[0]?.highlights.length).toBeGreaterThan(0);
      expect(results.every((r) => r.person.id !== DEMO_USER_A)).toBe(true);
    }
  });

  it("marks mutual interest and counts who is looking for you", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const results = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(results.find((r) => r.person.id === DEMO_USER_B)?.mutual).toBe(true);
    const { count } = await api.lookingForMe(ctx(DEMO_USER_B));
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("hides rejected people, batch-hides after three, and the soft blocker switches it off", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: "kubernetes scheduling preemption etcd raft argo gitops" }));
    const first = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(first.length).toBeGreaterThanOrEqual(4);

    let r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[0].person.id, rank: 0 }));
    expect(r.hiddenBelowRank).toBeNull();
    const afterOne = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(afterOne.some((x) => x.person.id === first[0].person.id)).toBe(false);

    await api.reject(ctx(DEMO_USER_A, { askId, personId: first[1].person.id, rank: 1 }));
    r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[2].person.id, rank: 2 }));
    expect(r.rejections).toBe(3);
    expect(r.hiddenBelowRank).toBe(2);

    await api.setSoftBlocker(ctx(DEMO_USER_A, { askId, enabled: false }));
    const off = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(off.some((x) => x.person.id === first[0].person.id)).toBe(true);
  });

  it("runs the whole flow: send, receive, accept, slot, book, resolve", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: DEMO_USER_B }));
    routes.sendRequest.response.parse(sent);
    expect(sent.question).toContain("preemption");

    const inbox = await api.inbox(ctx(DEMO_USER_B));
    expect(inbox.map((r) => r.id)).toContain(sent.id);

    await expect(api.respond(ctx(DEMO_USER_A, { action: "accept" }, { id: sent.id }))).rejects.toMatchObject({ status: 403 });
    const accepted = await api.respond(ctx(DEMO_USER_B, { action: "accept" }, { id: sent.id }));
    expect(accepted.status).toBe("accepted");

    const slots = await api.slots(ctx(DEMO_USER_A, undefined, { id: sent.id }));
    routes.slots.response.parse(slots);
    for (const s of slots) expect(Date.parse(s.start) - Date.now()).toBeGreaterThanOrEqual(60 * 60_000 - 1000);

    if (slots.length) {
      const booked = await api.schedule(ctx(DEMO_USER_A, { slot: slots[0] }, { id: sent.id }));
      expect(booked.status).toBe("scheduled");
      expect(booked.slot).toEqual(slots[0]);
    }

    const resolved = await api.resolve(ctx(DEMO_USER_A, undefined, { id: askId }));
    expect(resolved.status).toBe("resolved");
  });

  it("lets a receiver answer in a short reply without a meeting", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[2].raw }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: "p_002" }));
    const answered = await api.respond(ctx("p_002", { action: "reply", reply: "Compaction only trims below the snapshot index." }, { id: sent.id }));
    expect(answered.status).toBe("answered");
    expect(answered.reply).toMatch(/snapshot/);
  });
});
