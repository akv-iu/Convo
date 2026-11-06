import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { memorySearch } from "./memory";

describe("person updates without replacing evidence", () => {
  it("looks up fixture and newly ingested recipients without inventing unknown people", async () => {
    expect(await memorySearch.getPerson(people[0].id)).toEqual(people[0]);
    expect(await memorySearch.getPerson("unknown-recipient")).toBeUndefined();
    const person = { ...structuredClone(people[0]), id: "recipient-lookup-test", synthetic: false };
    await memorySearch.ingestPerson(person, [], 2);
    await memorySearch.ingestPerson({ ...person, name: "Stale" }, [], 1);
    expect(await memorySearch.getPerson(person.id)).toEqual(person);
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
