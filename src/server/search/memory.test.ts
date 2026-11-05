import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import { memorySearch } from "./memory";

describe("person updates without replacing evidence", () => {
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
});
