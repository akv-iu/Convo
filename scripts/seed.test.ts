import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDoc, Person } from "@/contracts/types";

const { ingestPerson, syncProfile, users } = vi.hoisted(() => ({ ingestPerson: vi.fn(), syncProfile: vi.fn(), users: [] as unknown[] }));
vi.mock("@/server/search/elastic", () => ({ elasticSearch: { ingestPerson }, client: vi.fn(), askDocument: vi.fn(), INDEX: {} }));
vi.mock("@/server/profile/service", () => ({ syncProfile }));
vi.mock("../db", () => ({ db: () => ({ select: () => ({ from: () => ({ where: async () => users }) }) }) }));

import { elasticSearch } from "@/server/search/elastic";
import { seedSynthetic, seedUsers } from "./seed";

beforeEach(() => {
  ingestPerson.mockReset();
  syncProfile.mockReset().mockResolvedValue(undefined);
  users.length = 0;
});

describe("seeding the synthetic attendees", () => {
  it("loads every attendee with their own evidence, eight at a time", async () => {
    let inFlight = 0;
    let most = 0;
    ingestPerson.mockImplementation(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });

    await expect(seedSynthetic()).resolves.toBe(500);

    expect(ingestPerson).toHaveBeenCalledTimes(500);
    for (const [person, docs] of ingestPerson.mock.calls as [Person, EvidenceDoc[]][]) {
      expect(docs.length).toBeGreaterThanOrEqual(2);
      expect(docs.every((doc) => doc.personId === person.id)).toBe(true);
    }
    expect(most).toBe(8);
  });

  it("fails with the first ingest error and starts nothing new after it", async () => {
    ingestPerson.mockImplementation(async (person: Person) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (person.id === "s_003") throw new Error("Evidence indexing failed: mapping conflict");
    });

    await expect(seedSynthetic()).rejects.toThrow("mapping conflict");
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the other workers finish what they started

    expect(ingestPerson.mock.calls.length).toBeLessThan(20);
  });
});

describe("seeding signed-up users", () => {
  it("replays each saved row through syncProfile straight into Elasticsearch, whatever the app's search switch says", async () => {
    const rows = [
      { id: "u_1", revision: 4, githubEvidence: [{ id: "u_1:repo:a" }], githubEvidencePending: true },
      { id: "u_2", revision: 1, githubEvidence: [], githubEvidencePending: false },
    ];
    users.push(...rows);

    await expect(seedUsers()).resolves.toEqual({ indexed: 2, failed: [] });

    expect(syncProfile).toHaveBeenCalledTimes(2);
    for (const [i, [user, target]] of syncProfile.mock.calls.entries()) {
      expect(user).toBe(rows[i]); // the whole row, so its saved evidence and revision are replayed
      expect(target).toBe(elasticSearch); // tests run with FAKE_API=1, as .env.local does
    }
  });

  it("reports a user who can't be synced and still syncs everyone else", async () => {
    users.push({ id: "u_1" }, { id: "u_2" }, { id: "u_3" });
    syncProfile.mockImplementation(async (user: { id: string }) => {
      if (user.id === "u_1") throw Object.assign(new Error("Stored profile evidence is invalid."), { status: 503 });
    });

    await expect(seedUsers()).resolves.toEqual({ indexed: 2, failed: ["u_1: Stored profile evidence is invalid."] });
    expect(syncProfile).toHaveBeenCalledTimes(3);
  });
});
