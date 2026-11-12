import { describe, expect, it, vi } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Person } from "@/contracts/types";

const { rows, listPeople } = vi.hoisted(() => ({ rows: vi.fn(), listPeople: vi.fn() }));
vi.mock("../../../db", () => ({ db: () => ({ select: () => ({ from: () => ({ where: rows }) }) }) }));
vi.mock("@/server/search", () => ({ search: { listPeople } }));
vi.mock("@/server/profile/service", () => ({ toPerson: (row: { person: Person }) => row.person }));
import { findPeople } from "./find";

const shown = { country: true, workplace: true, hiring: true };
const inSpain = (p: Person, over: Partial<Person> = {}): Person => ({ ...structuredClone(p), filters: { ...p.filters, country: "ES" }, visibility: shown, synthetic: false, ...over });

describe("findPeople (the real Find path)", () => {
  it("uses each account as saved, not search's copy: a country hidden since isn't found", async () => {
    const [me, hid, shows, neverOnboarded] = people;
    listPeople.mockResolvedValueOnce([inSpain(hid), inSpain(shows), inSpain(neverOnboarded)]);
    rows.mockResolvedValueOnce([
      { id: hid.id, filters: {}, person: inSpain(hid, { visibility: { ...shown, country: false } }) },
      { id: shows.id, filters: {}, person: inSpain(shows) },
      { id: neverOnboarded.id, filters: null, person: inSpain(neverOnboarded) }, // no saved profile: shows nothing
    ]);
    expect((await findPeople(me.id, "Spain")).map((p) => p.id)).toEqual([shows.id]);
  });

  it("an empty box finds no one without reading anything", async () => {
    expect(await findPeople("me", "  ")).toEqual([]);
    expect(listPeople).not.toHaveBeenCalled();
  });

  it("says the finder is unavailable when search or the database fails", async () => {
    listPeople.mockRejectedValueOnce(new Error("down"));
    await expect(findPeople("me", "Spain")).rejects.toMatchObject({ status: 503 });
    listPeople.mockResolvedValueOnce([inSpain(people[1])]);
    rows.mockRejectedValueOnce(new Error("down"));
    await expect(findPeople("me", "Spain")).rejects.toMatchObject({ status: 503 });
  });
});
