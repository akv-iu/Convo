import { describe, expect, it, vi } from "vitest";
import type { EvidenceDoc, Person } from "@/contracts/types";

const { ingestPerson, syncProfile, users } = vi.hoisted(() => ({ ingestPerson: vi.fn(), syncProfile: vi.fn(), users: [] as unknown[] }));
vi.mock("@/server/search/elastic", () => ({ elasticSearch: { ingestPerson }, client: vi.fn(), askDocument: vi.fn(), INDEX: {} }));
vi.mock("@/server/profile/service", () => ({ syncProfile }));
vi.mock("../db", () => ({ db: () => ({ select: () => ({ from: () => ({ where: async () => users }) }) }) }));

import { seedSynthetic, seedUsers } from "./seed";

describe("seed", () => {
  it("loads every synthetic attendee with their own evidence, eight at a time", async () => {
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

  it("loads signed-up users through syncProfile, which replays their saved GitHub evidence", async () => {
    users.push({ id: "u_1" }, { id: "u_2" });

    await expect(seedUsers()).resolves.toBe(2);

    expect(syncProfile.mock.calls.map(([user]) => user)).toEqual(users);
  });
});
