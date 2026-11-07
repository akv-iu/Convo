import { describe, expect, it } from "vitest";
import { routes } from "@/contracts/routes";
import { people } from "@/contracts/fixtures";
import { addChip, addPending, asSeenByOthers, changesFrom, draftFrom, LIMITS, loadProblem, nameProblem, removeChip } from "./edits";
import { SHOW_ALL } from "../answers";

const person = people[0];

describe("addChip", () => {
  it("adds a trimmed value", () => {
    expect(addChip(["Go"], "  Rust  ").list).toEqual(["Go", "Rust"]);
  });

  it("ignores blank input without complaint", () => {
    expect(addChip(["Go"], "   ")).toEqual({ list: ["Go"], problem: null });
  });

  it("refuses case-insensitive duplicates, overlong values and too many chips", () => {
    expect(addChip(["Go"], "go").problem).toMatch(/already/);
    expect(addChip([], "x".repeat(LIMITS.chip + 1)).problem).toMatch(/under/);
    const full = Array.from({ length: LIMITS.chips }, (_, i) => `skill ${i}`);
    expect(addChip(full, "one more").problem).toMatch(/up to/);
  });
});

describe("addPending (text left in an Add box on save)", () => {
  it("adds it like Add would", () => {
    expect(addPending(["Go"], "  Rust ")).toEqual({ list: ["Go", "Rust"], problem: null });
  });

  it("drops a duplicate quietly, since it's already on the badge", () => {
    expect(addPending(["Go"], "go")).toEqual({ list: ["Go"], problem: null });
  });

  it("stops the save for anything else Add would refuse", () => {
    expect(addPending([], "x".repeat(41)).problem).toMatch(/under 40/);
    expect(addPending(Array.from({ length: 12 }, (_, i) => `s${i}`), "one more").problem).toMatch(/up to 12/);
  });
});

describe("removeChip", () => {
  it("removes exactly that value", () => {
    expect(removeChip(["Go", "Rust"], "Go")).toEqual(["Rust"]);
  });
});

describe("changesFrom", () => {
  it("is empty when nothing changed", () => {
    const original = draftFrom(person);
    expect(changesFrom(original, draftFrom(person))).toEqual({});
  });

  it("sends only the fields that changed, trimmed", () => {
    const original = draftFrom(person);
    const draft = { ...original, bio: "  New bio  ", languages: [...original.languages, "Rust"] };
    const patch = changesFrom(original, draft);
    expect(patch).toEqual({ bio: "New bio", languages: [...original.languages, "Rust"] });
    expect(routes.putMe.body.parse(patch)).toEqual(patch);
  });

  it("treats a reordered or emptied list as a change", () => {
    const original = { name: "A", bio: "", languages: ["Go", "Rust"], organisations: ["cncf"] };
    expect(changesFrom(original, { ...original, languages: ["Rust", "Go"] })).toEqual({ languages: ["Rust", "Go"] });
    expect(changesFrom(original, { ...original, organisations: [] })).toEqual({ organisations: [] });
  });
});

describe("nameProblem", () => {
  it("needs a name of reasonable length", () => {
    expect(nameProblem({ name: "  ", bio: "", languages: [], organisations: [] })).toMatch(/Add/);
    expect(nameProblem({ name: "x".repeat(LIMITS.name + 1), bio: "", languages: [], organisations: [] })).toMatch(/under/);
    expect(nameProblem(draftFrom(person))).toBeNull();
  });
});

describe("loadProblem", () => {
  it("sends unfinished onboarding back to step 1, and expired sign-ins to sign in", () => {
    expect(loadProblem(409).action?.href).toBe("/signin");
    expect(loadProblem(401).action?.href).toBe("/signin");
    expect(loadProblem(404).action?.href).toBe("/signin");
    expect(loadProblem(503).action).toBeNull();
  });
});

describe("asSeenByOthers (step 4's preview of your row in other people's matches)", () => {
  it("empties the sections you hid, as the server does", () => {
    const me = { ...person, workplaceName: "Acme", filters: { country: "GB", rorId: "https://ror.org/x", hiring: true } };
    expect(asSeenByOthers(me, SHOW_ALL)).toMatchObject({ workplaceName: "Acme", filters: { country: "GB", hiring: true } });
    const seen = asSeenByOthers(me, { country: false, workplace: false, hiring: false });
    expect(seen.workplaceName).toBeNull();
    expect(seen.filters).toEqual({ country: null, rorId: null, hiring: null });
    expect(seen.name).toBe(me.name);
  });
});
