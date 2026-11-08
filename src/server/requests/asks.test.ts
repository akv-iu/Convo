import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import type { Ask } from "@/contracts/types";

const { query, getProfile, refineAsk, moderate, registerAsk, runMatch, after, afterTasks } = vi.hoisted(() => ({
  query: vi.fn(), getProfile: vi.fn(), refineAsk: vi.fn(), moderate: vi.fn(), registerAsk: vi.fn(), runMatch: vi.fn(),
  after: vi.fn(), afterTasks: [] as (() => Promise<unknown>)[],
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after }));
vi.mock("@/server/profile/service", () => ({ getProfile }));
vi.mock("@/server/ai", async () => ({ ai: { refineAsk, moderate }, ...await import("@/server/ai/blocked") }));
vi.mock("@/server/search", () => ({ search: { registerAsk } }));
vi.mock("@/server/pipeline", () => ({ runMatch }));
import { AskBlockedError } from "@/server/ai/blocked";
import { createAsk, matchAsk, previewAsk, saveAskAsWritten } from "./asks";

const person = people[0];
const refined = { text: "How does scheduler preemption work?", type: "knowledge" as const, minutes: 10 };
const ask: Ask = {
  id: "saved-ask", userId: person.id, rawText: "scheduler preemption", refined,
  status: "open", softBlocker: true, createdAt: "2026-11-05T12:00:00.000Z",
};
function askRows(value: Ask = ask) {
  return { rows: [[value.id, value.userId, value.rawText, JSON.stringify(value.refined), value.status, value.softBlocker, value.createdAt]] };
}
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  getProfile.mockReset().mockResolvedValue(person);
  refineAsk.mockReset().mockResolvedValue(refined);
  moderate.mockReset().mockResolvedValue(undefined);
  registerAsk.mockReset().mockResolvedValue(undefined);
  runMatch.mockReset().mockResolvedValue([]);
  afterTasks.length = 0;
  after.mockReset().mockImplementation((task: () => Promise<unknown>) => { afterTasks.push(task); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("durable ask creation", () => {
  it("saves a new ask under its owner before registering its refined text", async () => {
    registerAsk.mockImplementationOnce(async () => {
      expect(query).toHaveBeenCalledOnce();
    });
    const response = await createAsk(person.id, "scheduler preemption");
    expect(routes.refine.response.parse(response)).toEqual({ askId: expect.any(String), refined });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into "asks"');
    expect(sql).toContain('"soft_blocker"'); // set explicitly: off for new asks, whatever the column default
    expect(params).toEqual([response.askId, person.id, "scheduler preemption", JSON.stringify(refined), false]);
    expect(refineAsk).toHaveBeenCalledWith("scheduler preemption", person);
    expect(registerAsk).toHaveBeenCalledWith(response.askId, person.id, refined.text);
  });

  it("uses a distinct ID for each intentional submission", async () => {
    expect((await createAsk(person.id, "scheduler preemption")).askId)
      .not.toBe((await createAsk(person.id, "scheduler preemption")).askId);
  });

  it("rejects whitespace-only text before calling dependencies", async () => {
    await expect(createAsk(person.id, "   ")).rejects.toMatchObject({ status: 400 });
    expect(getProfile).not.toHaveBeenCalled();
    expect(refineAsk).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("requires a completed profile before AI or storage writes", async () => {
    getProfile.mockRejectedValueOnce(Object.assign(new Error("Complete onboarding first"), { status: 409 }));
    await expect(createAsk(person.id, "scheduler preemption")).rejects.toMatchObject({ status: 409 });
    expect(refineAsk).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([{ ...refined, minutes: 0 }, { ...refined, type: "invalid" }, { ...refined, text: " " }])(
    "does not persist an invalid AI reply", async (value) => {
      refineAsk.mockResolvedValueOnce(value);
      await expect(createAsk(person.id, "scheduler preemption")).rejects.toMatchObject({ status: 503 });
      expect(query).not.toHaveBeenCalled();
      expect(registerAsk).not.toHaveBeenCalled();
    },
  );

  it("sanitizes AI failures", async () => {
    refineAsk.mockRejectedValueOnce(new Error("private-provider-key"));
    const error = await createAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-provider-key");
    expect(query).not.toHaveBeenCalled();
  });

  it("passes a blocked ask to the screen as 422 and saves nothing", async () => {
    refineAsk.mockRejectedValueOnce(new AskBlockedError());
    await expect(createAsk(person.id, "an offensive ask")).rejects.toMatchObject({ status: 422, message: new AskBlockedError().message });
    expect(query).not.toHaveBeenCalled();
    expect(registerAsk).not.toHaveBeenCalled();
  });

  it("never registers a question that failed to save", async () => {
    query.mockRejectedValueOnce(new Error("private-database-url"));
    const error = await createAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-url");
    expect(registerAsk).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("runs the first match in the background after the response, so its explanations are cached", async () => {
    const { askId } = await createAsk(person.id, "scheduler preemption");
    expect(after).toHaveBeenCalledOnce();
    expect(runMatch).not.toHaveBeenCalled(); // nothing extra before the response

    query.mockResolvedValueOnce(askRows({ ...ask, id: askId }));
    await afterTasks[0]();

    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({ ask: expect.objectContaining({ id: askId }), requester: person }));
  });

  it("only logs, without provider details, when the background match fails", async () => {
    const { askId } = await createAsk(person.id, "scheduler preemption");
    query.mockResolvedValueOnce(askRows({ ...ask, id: askId }));
    runMatch.mockRejectedValueOnce(new Error("private-search-token"));

    await expect(afterTasks[0]()).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledWith("[asks] Background first match failed; the asker's own first match computes it.");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-search-token");
  });

  it("still answers when there is no request to run the background match after", async () => {
    after.mockImplementationOnce(() => { throw new Error("`after` was called outside a request scope."); });
    await expect(createAsk(person.id, "scheduler preemption")).resolves.toMatchObject({ refined });
  });

  it("returns the saved ask when registration fails and logs no provider details", async () => {
    registerAsk.mockRejectedValueOnce(new Error("private-search-token"));
    const saved = await createAsk(person.id, "scheduler preemption");
    expect(saved).toEqual({ askId: query.mock.calls[0][1][0], refined });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[asks] Ask saved; search registration failed. A later match will retry.");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-search-token");
    expect(query).toHaveBeenCalledOnce();
    expect(registerAsk).toHaveBeenCalledOnce();
  });
});

describe("previewing a sharper question", () => {
  it("returns the suggestion and saves, registers and matches nothing", async () => {
    await expect(previewAsk(person.id, "  scheduler preemption  ")).resolves.toEqual({ refined });
    expect(refineAsk).toHaveBeenCalledWith("scheduler preemption", person);
    expect(query).not.toHaveBeenCalled();
    expect(registerAsk).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("passes a blocked ask on as 422 and sanitizes other AI failures as 503", async () => {
    refineAsk.mockRejectedValueOnce(new AskBlockedError());
    await expect(previewAsk(person.id, "an offensive ask")).rejects.toMatchObject({ status: 422 });
    refineAsk.mockRejectedValueOnce(new Error("private-provider-key"));
    const error = await previewAsk(person.id, "scheduler preemption").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-provider-key");
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["  ", "x".repeat(501)])("refuses text outside 3 to 500 characters before calling anything", async (text) => {
    await expect(previewAsk(person.id, text)).rejects.toMatchObject({ status: 400 });
    expect(getProfile).not.toHaveBeenCalled();
    expect(refineAsk).not.toHaveBeenCalled();
  });
});

describe("saving an ask as written", () => {
  it("stores exactly the given text with the defaults, then registers it and warms the first match", async () => {
    registerAsk.mockImplementationOnce(async () => {
      expect(query).toHaveBeenCalledOnce(); // saved before it's registered
    });
    const saved = await saveAskAsWritten(person.id, { text: "  how does Raft do the voting thing  " });
    const asWritten = { text: "how does Raft do the voting thing", type: "knowledge", minutes: 5 };
    expect(routes.saveAsk.response.parse(saved)).toEqual({
      askId: expect.any(String),
      ask: { id: saved.askId, userId: person.id, rawText: asWritten.text, refined: asWritten, status: "open", softBlocker: false, createdAt: expect.any(String) },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('insert into "asks"');
    expect(params).toEqual(expect.arrayContaining([saved.askId, person.id, asWritten.text, JSON.stringify(asWritten), false]));
    expect(moderate).toHaveBeenCalledWith(asWritten.text);
    expect(refineAsk).not.toHaveBeenCalled(); // no rewrite
    expect(registerAsk).toHaveBeenCalledWith(saved.askId, person.id, asWritten.text);
    expect(after).toHaveBeenCalledOnce();
  });

  it("keeps a chosen type and length", async () => {
    const saved = await saveAskAsWritten(person.id, { text: "Would you mentor me?", type: "career", minutes: 15 });
    expect(saved.ask.refined).toEqual({ text: "Would you mentor me?", type: "career", minutes: 15 });
  });

  it("refuses a flagged ask with 422 and saves nothing", async () => {
    moderate.mockRejectedValueOnce(new AskBlockedError());
    await expect(saveAskAsWritten(person.id, { text: "an offensive ask" })).rejects.toMatchObject({ status: 422, message: new AskBlockedError().message });
    expect(query).not.toHaveBeenCalled();
    expect(registerAsk).not.toHaveBeenCalled();
  });

  it("refuses with a sanitized 503 when moderation is unavailable, rather than saving unchecked", async () => {
    moderate.mockRejectedValueOnce(new Error("private-provider-key"));
    const error = await saveAskAsWritten(person.id, { text: "scheduler preemption" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-provider-key");
    expect(query).not.toHaveBeenCalled();
  });

  it("reports a failed save as 503 and registers nothing", async () => {
    query.mockRejectedValueOnce(new Error("private-database-url"));
    const error = await saveAskAsWritten(person.id, { text: "scheduler preemption" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-url");
    expect(registerAsk).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("requires a completed profile and valid text before moderation or storage", async () => {
    await expect(saveAskAsWritten(person.id, { text: "hi" })).rejects.toMatchObject({ status: 400 });
    getProfile.mockRejectedValueOnce(Object.assign(new Error("Complete onboarding first"), { status: 409 }));
    await expect(saveAskAsWritten(person.id, { text: "scheduler preemption" })).rejects.toMatchObject({ status: 409 });
    expect(moderate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("matching a saved ask", () => {
  it("repairs a saved ask after registration failed without saving or refining again", async () => {
    registerAsk.mockRejectedValueOnce(new Error("private-search-token"));
    const { askId: savedId } = await createAsk(person.id, ask.rawText);
    const saved = { ...ask, id: savedId };
    query.mockResolvedValueOnce(askRows(saved));
    runMatch.mockImplementationOnce(async () => {
      expect(registerAsk).toHaveBeenLastCalledWith(savedId, person.id, refined.text);
      return [];
    });
    await expect(matchAsk(person.id, savedId)).resolves.toEqual([]);
    expect(registerAsk).toHaveBeenCalledTimes(2);
    expect(refineAsk).toHaveBeenCalledOnce();
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("insert"))).toHaveLength(1);
  });

  it("continues matching when replay fails and retries registration on the next match", async () => {
    query.mockResolvedValueOnce(askRows());
    registerAsk.mockRejectedValueOnce(new Error("private-search-token"));
    await expect(matchAsk(person.id, ask.id)).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-search-token");
    expect(runMatch).toHaveBeenCalledOnce();
    query.mockResolvedValueOnce(askRows());
    await expect(matchAsk(person.id, ask.id)).resolves.toEqual([]);
    expect(registerAsk).toHaveBeenCalledTimes(2);
    expect(refineAsk).not.toHaveBeenCalled();
  });

  it("starts registration alongside the profile, exclusion and pending-user reads", async () => {
    let releaseProfile: (value: typeof person) => void = () => {};
    getProfile.mockReturnValueOnce(new Promise(resolve => { releaseProfile = resolve; }));
    query.mockResolvedValueOnce(askRows());
    const matching = matchAsk(person.id, ask.id);
    await vi.waitFor(() => {
      expect(query).toHaveBeenCalledTimes(4); // ask, rejections, pending users, requests already sent
      expect(registerAsk).toHaveBeenCalledExactlyOnceWith(ask.id, person.id, refined.text);
    });
    expect(runMatch).not.toHaveBeenCalled();
    releaseProfile(person);
    await expect(matching).resolves.toEqual([]);
  });

  it.each([
    { ...ask, status: "resolved" as const },
    { ...ask, refined: null },
  ])("does not register a closed or unrefined ask: $status, $refined", async (saved) => {
    query.mockResolvedValueOnce(askRows(saved));
    await matchAsk(person.id, saved.id);
    expect(registerAsk).not.toHaveBeenCalled();
  });

  it("excludes pending imports before search and explanations even with the soft blocker off", async () => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker: false }))
      .mockResolvedValueOnce({ rows: [["rejected", 1]] }).mockResolvedValueOnce({ rows: [["pending-user"]] });
    await matchAsk(person.id, ask.id);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({ excludeIds: ["pending-user"] }));
    expect(query.mock.calls[2][1]).toEqual([true, person.id, "open", true]);
    expect(query.mock.calls[2][0]).toContain('"users"."filters" is not null');
  });

  it.each([true, false])("honors other attendees' rejections regardless of this ask's blocker=%s", async (softBlocker) => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker }))
      .mockResolvedValueOnce({ rows: [["outgoing", 1]] })
      .mockResolvedValueOnce({ rows: [["reverse-blocker"], ["pending-user"]] });
    await matchAsk(person.id, ask.id);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({
      excludeIds: ["reverse-blocker", "pending-user"],
      hideIds: softBlocker ? ["outgoing"] : [],
    }));
    const [sql, params] = query.mock.calls[2];
    expect(sql).toContain('union (select "asks"."user_id"');
    expect(sql).toContain('inner join "rejections" on "rejections"."ask_id" = "asks"."id"');
    expect(sql).toContain('"rejections"."person_id" = $2');
    expect(sql).toContain('"asks"."status" = $3');
    expect(sql).toContain('"asks"."soft_blocker" = $4');
    expect(params).toEqual([true, person.id, "open", true]);
  });

  it("starts exclusion and pending reads while the requester profile is still loading", async () => {
    let releaseProfile: (value: typeof person) => void = () => {};
    getProfile.mockReturnValueOnce(new Promise(resolve => { releaseProfile = resolve; }));
    query.mockResolvedValueOnce(askRows());
    const matching = matchAsk(person.id, ask.id);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(4));
    expect(runMatch).not.toHaveBeenCalled();
    releaseProfile(person);
    await expect(matching).resolves.toEqual([]);
  });

  it("preserves the onboarding error when concurrent profile loading fails", async () => {
    query.mockResolvedValueOnce(askRows());
    getProfile.mockRejectedValueOnce(Object.assign(new Error("Complete onboarding first"), { status: 409 }));
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 409 });
    expect(runMatch).not.toHaveBeenCalled();
  });
  it("withholds stale evidence and explanations until the owner's imported evidence is synchronized", async () => {
    const pending = { ...person, id: "pending-evidence", synthetic: false };
    const ready = { ...person, id: "ready-evidence", synthetic: false };
    const visible = { country: true, workplace: true, hiring: true };
    runMatch.mockResolvedValueOnce([pending, ready].map((candidate, rank) => ({ person: candidate,
      badges: [], evidence: [], highlights: ["Old repository"], mutual: false, explanation: "Old repository explanation", score: 1, rank })));
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [
        [pending.id, JSON.stringify(visible), true], [ready.id, JSON.stringify(visible), false],
      ] });
    const cards = await matchAsk(person.id, ask.id);
    expect(cards.map(card => card.person.id)).toEqual([ready.id]);
  });
  it("uses current database visibility even when search contains an older public profile", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [["candidate", JSON.stringify({ country: false, workplace: false, hiring: false })]] });
    const candidate = { ...person, id: "candidate", synthetic: false, workplaceName: "Acme" };
    runMatch.mockResolvedValueOnce([{ person: candidate, badges: [candidate.filters.country, "hiring"], evidence: [], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    const [card] = await matchAsk(person.id, ask.id);
    expect(card.person.filters).toEqual({ country: null, rorId: null, hiring: null });
    expect(card.person.workplaceName).toBeNull();
    expect(card.badges).toEqual([]);
    expect(query.mock.calls[4][1]).toEqual(["candidate"]);
    expect(candidate.filters).toEqual(person.filters);
  });

  it("fails closed when a real candidate's current privacy cannot be loaded", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockResolvedValueOnce([{ person: { ...person, synthetic: false }, badges: [], evidence: [], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    expect((await matchAsk(person.id, ask.id))[0].person.filters).toEqual({ country: null, rorId: null, hiring: null });
  });

  it("does not return cards when the current privacy read fails", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("private-database-token"));
    runMatch.mockResolvedValueOnce([{ person, badges: [], evidence: [], highlights: [], mutual: false, explanation: "Match", score: 1, rank: 0 }]);
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-token");
  });

  it("does not search when pending imports cannot be loaded", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("private-database-token"));
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-token");
    expect(runMatch).not.toHaveBeenCalled();
  });
  it("scopes the ask lookup to its owner and passes saved answers to the pipeline", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    expect(await matchAsk(person.id, ask.id, "raft")).toEqual([]);
    expect(query.mock.calls[0][0]).toContain('where ("asks"."id" = $1 and "asks"."user_id" = $2)');
    expect(query.mock.calls[0][1]).toEqual([ask.id, person.id, 1]);
    expect(runMatch).toHaveBeenCalledWith({ ask, requester: person, query: "raft", excludeIds: [], hideIds: [], hiddenBelowRank: null });
  });

  it("hides existence of another user's or a missing ask", async () => {
    await expect(matchAsk("different-user", ask.id)).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0][1]).toEqual([ask.id, "different-user", 1]);
    expect(query).toHaveBeenCalledOnce();
    expect(getProfile).not.toHaveBeenCalled();
    expect(registerAsk).not.toHaveBeenCalled();
    expect(runMatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("passes persisted exclusions and the batch cutoff with blocker=%s", async (softBlocker) => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker })).mockResolvedValueOnce({ rows: [["p1", 0], ["p2", 2], ["p3", 4]] });
    await matchAsk(person.id, ask.id);
    expect(query.mock.calls[1][1]).toEqual([ask.id]);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({
      excludeIds: [], hideIds: softBlocker ? ["p1", "p2", "p3"] : [], hiddenBelowRank: 4,
    }));
  });

  it("does not impose the batch cutoff below the configured threshold", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [["p1", 4]] });
    await matchAsk(person.id, ask.id);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({ excludeIds: [], hideIds: ["p1"], hiddenBelowRank: null }));
  });

  it.each([true, false])("hides people this ask already sent a request to, with blocker=%s", async (softBlocker) => {
    query.mockResolvedValueOnce(askRows({ ...ask, softBlocker })).mockResolvedValueOnce({ rows: [["passed", 1]] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [["requested"]] });
    await matchAsk(person.id, ask.id);
    expect(query.mock.calls[3][0]).toContain('select "to_person_id" from "requests" where "requests"."ask_id" = $1');
    expect(query.mock.calls[3][1]).toEqual([ask.id]);
    expect(runMatch).toHaveBeenCalledWith(expect.objectContaining({
      excludeIds: [], hideIds: [...(softBlocker ? ["passed"] : []), "requested"],
    }));
  });

  it("does not search when requests already sent cannot be loaded", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("private-database-token"));
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-database-token");
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("rejects invalid stored asks before the pipeline", async () => {
    query.mockResolvedValueOnce(askRows({ ...ask, refined: { ...refined, minutes: 0 } }));
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("does not show possibly rejected people when exclusion storage fails", async () => {
    query.mockResolvedValueOnce(askRows()).mockRejectedValueOnce(new Error("private-db-password"));
    const error = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private-db-password");
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("rejects corrupt exclusion ranks before the pipeline", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [["p1", -1]] });
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
    expect(runMatch).not.toHaveBeenCalled();
  });

  it("rejects an off-contract pipeline result", async () => {
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockResolvedValueOnce([{ person: { id: "missing-fields" } }]);
    await expect(matchAsk(person.id, ask.id)).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes database and pipeline failures", async () => {
    query.mockRejectedValueOnce(new Error("private-database-url"));
    const dbError = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(dbError).toMatchObject({ status: 503 });
    expect(String(dbError)).not.toContain("private-database-url");
    query.mockResolvedValueOnce(askRows()).mockResolvedValueOnce({ rows: [] });
    runMatch.mockRejectedValueOnce(new Error("private-provider-key"));
    const pipelineError = await matchAsk(person.id, ask.id).catch((e: unknown) => e);
    expect(pipelineError).toMatchObject({ status: 503 });
    expect(String(pipelineError)).not.toContain("private-provider-key");
  });
});
