import { describe, expect, it } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, people } from "@/contracts/fixtures";
import { memorySearch } from "./memory";

const byId = (id: string) => {
  const person = people.find((p) => p.id === id);
  if (!person) throw new Error(`no fixture ${id}`);
  return person;
};

describe("fixture mutual interest", () => {
  it("lists the people looking for someone like the given user, not the people that user wants", async () => {
    expect(await memorySearch.whoIsLookingFor(byId(DEMO_USER_A))).toEqual(expect.arrayContaining([DEMO_USER_B, "p_006"]));
    expect(await memorySearch.whoIsLookingFor(byId(DEMO_USER_B))).toEqual(["p_006"]);
  });
});

describe("hard filters", () => {
  it("keeps only people matching every given filter", async () => {
    const { country, hiring } = byId(DEMO_USER_B).filters;
    const all = await memorySearch.searchCandidates("kubernetes scheduler preemption etcd raft", { excludeIds: [] });
    const filtered = await memorySearch.searchCandidates("kubernetes scheduler preemption etcd raft", { excludeIds: [], hard: { country, hiring } });
    expect(filtered.map((c) => c.person.id)).toContain(DEMO_USER_B);
    expect(filtered.every((c) => c.person.filters.country === country && c.person.filters.hiring === hiring)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });
});

describe("ask lifecycle", () => {
  it("counts a person once, removes only the resolved ask, and ignores late registration", async () => {
    const target = { ...people[0], id: "lifecycle-target", bio: "LifecycleUniqueTopic" };
    await memorySearch.registerAsk("lifecycle-one", "lifecycle-owner", target.bio);
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual(["lifecycle-owner"]);
    await memorySearch.removeAsk("lifecycle-one");
    expect(await memorySearch.whoIsLookingFor(target)).toEqual(["lifecycle-owner"]);
    await memorySearch.removeAsk("lifecycle-two");
    await memorySearch.removeAsk("lifecycle-two");
    await memorySearch.registerAsk("lifecycle-two", "lifecycle-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual([]);
  });
  it("does not revive an ask when resolution finishes before registration", async () => {
    const target = { ...people[0], id: "late-target", bio: "LateRegistrationTopic" };
    await memorySearch.removeAsk("late-ask");
    await memorySearch.registerAsk("late-ask", "late-owner", target.bio);
    expect(await memorySearch.whoIsLookingFor(target)).toEqual([]);
  });
});

describe("person updates without replacing evidence", () => {
  it("looks up fixture and newly ingested recipients without inventing unknown people", async () => {
    expect(await memorySearch.getPerson(people[0].id)).toEqual(people[0]);
    expect(await memorySearch.getPerson("unknown-recipient")).toBeUndefined();
    const person = { ...structuredClone(people[0]), id: "recipient-lookup-test", synthetic: false };
    await memorySearch.ingestPerson(person, [], 2);
    await memorySearch.ingestPerson({ ...person, name: "Stale" }, [], 1);
    expect(await memorySearch.getPerson(person.id)).toEqual(person);
  });

  it("reads several people at once, leaving out unknown IDs", async () => {
    expect(await memorySearch.getPeople([people[0].id, "unknown-recipient", people[1].id])).toEqual([people[0], people[1]]);
  });

  it("preserves repository evidence while updating profile fields and availability", async () => {
    const person = { ...structuredClone(people[0]), id: "evidence-update-test" };
    await memorySearch.ingestPerson(person, [{
      id: "repo-evidence-test", personId: person.id, kind: "repo", title: "EvidenceOnlyToken", text: "Repository evidence",
    }]);
    const updated = { ...person, name: "Updated name", freeTimes: [] };
    await memorySearch.ingestPerson(updated);
    const found = await memorySearch.searchCandidates("EvidenceOnlyToken", { excludeIds: [] });
    expect(found.map((candidate) => candidate.person.id)).toContain(person.id);
    expect(found.find((candidate) => candidate.person.id === person.id)?.person.name).toBe("Updated name");
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: [] });
    await memorySearch.ingestPerson(updated, []);
    expect((await memorySearch.searchCandidates("EvidenceOnlyToken", { excludeIds: [] })).map((candidate) => candidate.person.id)).not.toContain(person.id);
  });

  it("can register a new profile before repository evidence has been ingested", async () => {
    const person = { ...structuredClone(people[0]), id: "new-profile-test" };
    await memorySearch.ingestPerson(person);
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: person.freeTimes });
  });

  it("ignores older and unversioned writes after a versioned write, including their evidence", async () => {
    const person = { ...structuredClone(people[0]), id: "versioned-profile-test", bio: "RevisionToken" };
    const docs = [{ id: "versioned-doc", personId: person.id, kind: "repo" as const, title: "RevisionEvidence", text: "" }];
    await memorySearch.ingestPerson(person, docs, 2);
    const stale = { ...person, name: "Stale name" };
    await memorySearch.ingestPerson(stale, [], 1);
    await memorySearch.ingestPerson(stale, []);
    const hits = await memorySearch.searchCandidates("RevisionEvidence", { excludeIds: [] });
    expect(hits.find((hit) => hit.person.id === person.id)?.person).toEqual(person);
    await memorySearch.ingestPerson({ ...person, freeTimes: [] }, undefined, 3);
    expect(await memorySearch.getAvailability([person.id])).toEqual({ [person.id]: [] });
    await memorySearch.ingestPerson({ ...person, freeTimes: [] }, [], 3);
    expect(await memorySearch.searchCandidates("RevisionEvidence", { excludeIds: [] })).toEqual([]);
  });
});
