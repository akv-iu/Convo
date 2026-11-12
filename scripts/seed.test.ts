import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceDoc, Person } from "@/contracts/types";
import { asks as asksTable } from "../db/schema";

const { ingestPerson, syncProfile, users, asks, bulk, refresh } = vi.hoisted(() => ({ ingestPerson: vi.fn(), syncProfile: vi.fn(), users: [] as unknown[], asks: [] as unknown[], bulk: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/search/elastic", () => ({ elasticSearch: { ingestPerson }, client: () => ({ bulk, indices: { refresh } }), askDocument: (id: string) => ({ id }), INDEX: { asks: "asks" } }));
vi.mock("@/server/profile/service", () => ({ syncProfile }));
vi.mock("../db", () => ({ db: () => ({ select: () => ({ from: (table: unknown) => ({ where: async () => table === asksTable ? asks : users }) }) }) }));

import { elasticSearch } from "@/server/search/elastic";
import { COUNT } from "./synthetic/plan";
import { seedSynthetic, seedUsers } from "./seed";

beforeEach(() => {
  ingestPerson.mockReset();
  syncProfile.mockReset().mockResolvedValue(undefined);
  users.length = 0;
  asks.length = 0;
  bulk.mockReset().mockResolvedValue({ items: [] });
  refresh.mockReset().mockResolvedValue({});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

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

    await expect(seedSynthetic()).resolves.toBe(COUNT);

    expect(ingestPerson).toHaveBeenCalledTimes(COUNT);
    for (const [person, docs] of ingestPerson.mock.calls as [Person, EvidenceDoc[]][]) {
      expect(docs.length).toBeGreaterThanOrEqual(6);
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

  it("continues beyond the first worker batch and returns only failed IDs, never provider text", async () => {
    users.push(...Array.from({ length: 20 }, (_, i) => ({ id: `u_${i}` })));
    syncProfile.mockImplementation(async (user: { id: string }) => {
      if (user.id === "u_0") throw new Error("private CV text and provider-token");
      if (user.id === "u_1") throw "another private error";
    });
    const result = await seedUsers();
    expect(result).toEqual({ indexed: 18, failed: ["u_0", "u_1"] });
    expect(syncProfile).toHaveBeenCalledTimes(20);
    expect(JSON.stringify(result)).not.toMatch(/private|token/);
  });
});
it("finishes open asks and refresh before reporting an incomplete run as failure", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused@example.invalid/unused");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  users.push({ id: "u_bad" }, { id: "u_good" });
  asks.push({ id: "ask", userId: "u_good", refined: { text: "Find a researcher" } });
  syncProfile.mockImplementation(async (user: { id: string }) => { if (user.id === "u_bad") throw new Error("private provider text"); });
  const { seed } = await import("./seed");
  await expect(seed()).rejects.toThrow("User seeding incomplete.");
  expect(bulk).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  expect(bulk.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  expect(console.log).toHaveBeenCalledWith("ingested 1 signed-up users");
  expect(console.error).toHaveBeenCalledExactlyOnceWith("Signed-up users could not be indexed", { count: 1, ids: ["u_bad"] });
});
it("completes successfully when every signed-up user recovers", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused@example.invalid/unused");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  users.push({ id: "u_good" });
  const { seed } = await import("./seed");
  await expect(seed()).resolves.toBeUndefined();
  expect(refresh).toHaveBeenCalledOnce(); expect(console.error).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith("ingested 1 signed-up users");
});
it("seeds fixtures without attempting database users or asks when no database is configured", async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { seed } = await import("./seed");
  await expect(seed()).resolves.toBeUndefined();
  expect(syncProfile).not.toHaveBeenCalled(); expect(bulk).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
});
