import { afterEach, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Person } from "@/contracts/types";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/config", () => ({ config: { fakeApi: false, fakeSearch: true } }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { updateProfile, saveAvailability } from "./service";
import { getPerson } from "@/server/search/memory";

function row(person: Person, revision: number) {
  return { rows: [[person.id, person.githubLogin, person.name, person.bio,
    JSON.stringify(person.languages), JSON.stringify(person.organisations), JSON.stringify(person.filters),
    JSON.stringify(person.freeTimes), "2026-11-05T00:00:00Z", revision]] };
}
afterEach(() => vi.unstubAllEnvs());

it("keeps the latest search metadata when an older database response arrives last", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  const original = { ...structuredClone(people[0]), id: "concurrent-profile-test" };
  const first = { ...original, name: "New name" };
  const latest = { ...first, freeTimes: [] };
  let finishFirst!: (value: ReturnType<typeof row>) => void;
  const delayedReply = new Promise<ReturnType<typeof row>>((resolve) => { finishFirst = resolve; });
  let firstCommitted!: () => void;
  const committed = new Promise<void>((resolve) => { firstCommitted = resolve; });
  query.mockResolvedValueOnce(row(original, 0))
    .mockImplementationOnce(() => { firstCommitted(); return delayedReply; })
    .mockResolvedValueOnce(row(latest, 2));

  const pending = updateProfile(original.id, { name: first.name });
  await committed;
  await saveAvailability(original.id, []);
  finishFirst(row(first, 1));
  await pending;

  expect(getPerson(original.id)).toEqual(latest);
});
