/**
 * Contract tests. They run against the fake now; when B's real handlers are
 * ready, add them to `implementations` and the same tests prove the swap
 * is safe.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, sampleAsks } from "@/contracts/fixtures";
import { search } from "@/server/search";
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

  it("keeps GitHub identity server-owned and preserves omitted expertise", async () => {
    const me = await api.getMe(ctx(DEMO_USER_A));
    const body = routes.putMe.body.parse({ githubLogin: "another-person", badgeColour: "lilac" });
    expect(body).not.toHaveProperty("githubLogin");
    expect(body).not.toHaveProperty("expertise");
    expect((await api.putMe(ctx(DEMO_USER_A, body))).githubLogin).toBe(me.githubLogin);
  });

  it("hides card fields while retaining owner data and matching results", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const before = await api.match(ctx(DEMO_USER_A, { askId }));
    const target = before[0].person.id;
    const original = await api.getMe(ctx(target));
    await api.putMe(ctx(target, { workplaceName: "Acme", visibility: { country: false, workplace: false, hiring: false } }));
    const after = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(after.map(card => card.person.id)).toEqual(before.map(card => card.person.id));
    expect(after[0].person).toMatchObject({ workplaceName: null, filters: { country: null, rorId: null, hiring: null } });
    expect(await api.getMe(ctx(target))).toMatchObject({ workplaceName: "Acme", filters: original.filters });
    expect((await search.getPerson(target))?.filters).toEqual(original.filters);
    await api.putMe(ctx(target, { visibility: { country: true, workplace: true, hiring: true } }));
    expect((await api.match(ctx(DEMO_USER_A, { askId })))[0].person).toMatchObject({ workplaceName: "Acme", filters: original.filters });
  });

  it.each([{ visibility: { country: false } }, { visibility: { country: "false", workplace: true, hiring: true } }])(
    "rejects invalid visibility %j", body => expect(routes.putMe.body.safeParse(body).success).toBe(false),
  );

  it("resolves one ask at a time and removes it from reverse search", async () => {
    const first = await api.refine(ctx(DEMO_USER_A, { text: "UniqueLifecycleTopic" }));
    const second = await api.refine(ctx(DEMO_USER_A, { text: "UniqueLifecycleTopic" }));
    const target = { ...await api.getMe(ctx(DEMO_USER_B)), id: "lifecycle-contract-target", bio: "UniqueLifecycleTopic" };
    expect(await search.whoIsLookingFor(target)).toContain(DEMO_USER_A);
    await expect(api.resolve(ctx(DEMO_USER_B, undefined, { id: first.askId }))).rejects.toMatchObject({ status: 404 });
    await api.resolve(ctx(DEMO_USER_A, undefined, { id: first.askId }));
    expect(await search.whoIsLookingFor(target)).toContain(DEMO_USER_A);
    expect(await api.resolve(ctx(DEMO_USER_A, undefined, { id: second.askId }))).toMatchObject({ status: "resolved" });
    await api.resolve(ctx(DEMO_USER_A, undefined, { id: second.askId }));
    expect(await search.whoIsLookingFor(target)).not.toContain(DEMO_USER_A);
  });

  it("saves a workplace name and badge colour, preserves them on unrelated edits and clears the workplace", async () => {
    const body = routes.putMe.body.parse({ workplaceName: "  Acme Robotics  ", badgeColour: "lilac" });
    const saved = await api.putMe(ctx(DEMO_USER_A, body));
    expect(saved).toMatchObject({ workplaceName: "Acme Robotics", badgeColour: "lilac" });
    await api.putMe(ctx(DEMO_USER_A, { bio: "Updated biography" }));
    expect(await api.getMe(ctx(DEMO_USER_A))).toMatchObject({ workplaceName: "Acme Robotics", badgeColour: "lilac" });
    expect(await api.putMe(ctx(DEMO_USER_A, { workplaceName: null }))).toMatchObject({ workplaceName: null, badgeColour: "lilac" });
  });

  it.each([{ workplaceName: " " }, { workplaceName: "x".repeat(201) }, { badgeColour: "neon" }])(
    "rejects invalid profile presentation %j", (body) => {
      expect(routes.putMe.body.safeParse(body).success).toBe(false);
    },
  );

  it("clears a stale workplace label when an older client changes its ROR ID", async () => {
    const me = await api.putMe(ctx(DEMO_USER_A, { workplaceName: "Original workplace" }));
    expect(await api.putMe(ctx(DEMO_USER_A, { filters: { ...me.filters, country: "GB" } }))).toMatchObject({ workplaceName: "Original workplace" });
    expect(await api.putMe(ctx(DEMO_USER_A, { filters: { ...me.filters, rorId: null } }))).toMatchObject({ workplaceName: null });
  });

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

  it("lists each match's evidence, best first, with only https links", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const results = routes.match.response.parse(await api.match(ctx(DEMO_USER_A, { askId })));
    expect(results.every((r) => r.evidence.length <= 5 && r.evidence.every((e) => !e.url || e.url.startsWith("https://")))).toBe(true);
    const b = results.find((r) => r.person.id === DEMO_USER_B);
    expect(b?.evidence[0]).toMatchObject({ kind: "commit_area", url: expect.stringMatching(/^https:\/\/github\.com\//) });
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
    // Everyone else keeps their rank, so the rank sent with a later rejection means the same place.
    for (const card of afterOne) {
      const before = first.find((x) => x.person.id === card.person.id);
      if (before) expect(card.rank).toBe(before.rank);
    }

    // A repeat (retry, double tap) is not counted again.
    r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[0].person.id, rank: 0 }));
    expect(r.rejections).toBe(1);

    await api.reject(ctx(DEMO_USER_A, { askId, personId: first[1].person.id, rank: 1 }));
    r = await api.reject(ctx(DEMO_USER_A, { askId, personId: first[2].person.id, rank: 2 }));
    expect(r.rejections).toBe(3);
    expect(r.hiddenBelowRank).toBe(2);
    // Ranks 0-2 were passed on and everyone ranked below the last of them is hidden: no one is left.
    expect(await api.match(ctx(DEMO_USER_A, { askId }))).toEqual([]);

    await api.setSoftBlocker(ctx(DEMO_USER_A, { askId, enabled: false }));
    const off = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(off.map((x) => [x.person.id, x.rank])).toEqual(first.slice(0, 2).map((x) => [x.person.id, x.rank]));
  });

  it("sends one request per person per ask and leaves them out of later matches", async () => {
    const { askId } = await api.refine(ctx(DEMO_USER_A, { text: "kubernetes scheduling preemption etcd raft argo gitops" }));
    const first = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(first.length).toBeGreaterThanOrEqual(2);
    const to = first[0].person.id;

    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: to }));
    expect(await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: to }))).toEqual(sent);
    expect((await api.inbox(ctx(to))).filter((x) => x.askId === askId)).toHaveLength(1);

    const after = await api.match(ctx(DEMO_USER_A, { askId }));
    expect(after.some((x) => x.person.id === to)).toBe(false);
    expect(after.find((x) => x.person.id === first[1].person.id)?.rank).toBe(first[1].rank);
  });

  it("shows each side the other person's badge, and lets the asker follow the reply and booking", async () => {
    const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    const asker = await api.putMe(ctx(DEMO_USER_A, { visibility: { country: false, workplace: true, hiring: true } }));
    const sent = await api.sendRequest(ctx(DEMO_USER_A, { askId, toPersonId: DEMO_USER_B }));

    // The receiver sees who is asking (with the asker's hidden sections left out) and what kind of ask it is.
    const [received] = routes.inbox.response.parse(await api.inbox(ctx(DEMO_USER_B)));
    expect(received).toMatchObject({ id: sent.id, type: refined.type });
    expect(received.person).toMatchObject({ id: DEMO_USER_A, name: asker.name, filters: { country: null } });
    expect(received.person).not.toHaveProperty("visibility");

    // The asker sees the receiver's badge, then their answer.
    let [mine] = routes.sentRequests.response.parse(await api.sentRequests(ctx(DEMO_USER_A)));
    expect(mine).toMatchObject({ id: sent.id, status: "sent", type: refined.type, person: { id: DEMO_USER_B } });
    await api.respond(ctx(DEMO_USER_B, { action: "reply", reply: "Use priority classes." }, { id: sent.id }));
    [mine] = await api.sentRequests(ctx(DEMO_USER_A));
    expect(mine).toMatchObject({ status: "answered", reply: "Use priority classes." });
    expect(await api.sentRequests(ctx(DEMO_USER_B))).toEqual([]);
  });

  it("previews a sharper question without saving or registering an ask", async () => {
    const before = store.get().asks.size;
    const preview = routes.previewRefine.response.parse(await api.previewRefine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw })));
    expect(preview.refined.text).toContain(sampleAsks[0].raw.replace(/[.?!]+$/, ""));
    expect(store.get().asks.size).toBe(before);
    await expect(api.previewRefine(ctx(DEMO_USER_A, { text: "you idiot" }))).rejects.toMatchObject({ status: 422 });
  });

  it("saves an ask exactly as written, with the defaults, and it matches like any other", async () => {
    const text = "How do you size etcd for a 500-node cluster?";
    const saved = routes.saveAsk.response.parse(await api.saveAsk(ctx(DEMO_USER_A, { text })));
    expect(saved.ask).toMatchObject({ id: saved.askId, userId: DEMO_USER_A, rawText: text, status: "open", softBlocker: false });
    expect(saved.ask.refined).toEqual({ text, type: "knowledge", minutes: 5 });
    expect(await api.getAsk(ctx(DEMO_USER_A, undefined, { id: saved.askId }))).toEqual(saved.ask);
    expect(Array.isArray(await api.match(ctx(DEMO_USER_A, { askId: saved.askId })))).toBe(true);
    const chosen = await api.saveAsk(ctx(DEMO_USER_A, { text, type: "collaboration", minutes: 15 }));
    expect(chosen.ask.refined).toEqual({ text, type: "collaboration", minutes: 15 });
    const before = store.get().asks.size;
    await expect(api.saveAsk(ctx(DEMO_USER_A, { text: "you idiot" }))).rejects.toMatchObject({ status: 422 });
    expect(store.get().asks.size).toBe(before);
  });

  it("checks the as-written bodies at the contract", () => {
    expect(routes.saveAsk.body.parse({ text: "  Hi there  " })).toEqual({ text: "Hi there" });
    expect(routes.saveAsk.body.safeParse({ text: "  ok  " }).success).toBe(false); // trimmed below 3
    expect(routes.saveAsk.body.safeParse({ text: "x".repeat(501) }).success).toBe(false);
    expect(routes.saveAsk.body.safeParse({ text: "Hi there", type: "gossip" }).success).toBe(false);
    expect(routes.saveAsk.body.safeParse({ text: "Hi there", minutes: 4 }).success).toBe(false);
    expect(routes.saveAsk.body.safeParse({ text: "Hi there", minutes: 31 }).success).toBe(false);
    expect(routes.saveAsk.body.safeParse({ text: "Hi there", minutes: 7.5 }).success).toBe(false);
    expect(routes.previewRefine.body.safeParse({ text: "x".repeat(501) }).success).toBe(false);
  });

  it("reads back the caller's own ask, including its soft-blocker setting", async () => {
    const { askId, refined } = await api.refine(ctx(DEMO_USER_A, { text: sampleAsks[0].raw }));
    expect(routes.getAsk.response.parse(await api.getAsk(ctx(DEMO_USER_A, undefined, { id: askId }))))
      .toMatchObject({ id: askId, userId: DEMO_USER_A, refined, status: "open", softBlocker: true });
    await api.setSoftBlocker(ctx(DEMO_USER_A, { askId, enabled: false }));
    expect(await api.getAsk(ctx(DEMO_USER_A, undefined, { id: askId }))).toMatchObject({ softBlocker: false });
    await expect(api.getAsk(ctx(DEMO_USER_B, undefined, { id: askId }))).rejects.toMatchObject({ status: 404 });
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
