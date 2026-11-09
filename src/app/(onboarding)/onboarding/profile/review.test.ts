import { describe, expect, it, vi } from "vitest";
import { AcceptEnrichment, type EnrichmentJob } from "@/contracts/enrichment";
import { people } from "@/contracts/fixtures";
import type { Person } from "@/contracts/types";
import { acceptBody, acceptProblem, carryEdits, claimsWithoutEvidence, evidenceTitle, hiddenFacts, initialPicks, keepEdits, readKept, reviewView, saveKept } from "./review";

type Draft = NonNullable<EnrichmentJob["draft"]>;
type Evidence = Draft["evidence"][number];

const evidence = (id: string, source: Evidence["source"], extra: Partial<Evidence> = {}): Evidence => ({
  id: `u1:${id}`, personId: "u1", sourceId: `u1:${source}`, source, kind: "paper", title: id, excerpt: `${id} excerpt`,
  retrievedAt: "2026-11-07T12:00:00Z", ...extra,
});
const paper = evidence("paper:W1", "research", { url: "https://openalex.org/W1" });
const pasted = evidence("profile_page:text", "public_profile", { kind: "profile_page", title: "Profile text" });
const cv = evidence("cv:1", "cv", { kind: "cv" });
const draft: Draft = {
  draftVersion: 2, baseTextVersion: 5, bio: "  I calibrate qubits.  ", bioEvidenceIds: [paper.id, cv.id],
  expertise: [{ label: "Qubit calibration", evidenceIds: [paper.id] }, { label: "Lab safety", evidenceIds: [cv.id] }],
  evidence: [paper, pasted, cv], needsReview: false,
};
const job = (state: EnrichmentJob["state"], withDraft = true) => ({ state, draft: withDraft ? draft : null });

describe("reviewView", () => {
  it("reviews a ready or partly ready draft, waits on running work, and offers help for stuck work", () => {
    expect(reviewView(null)).toBe("none");
    for (const state of ["manual", "cancelled", "superseded"] as const) expect(reviewView(job(state, false))).toBe("none");
    expect(reviewView(job("accepted"))).toBe("done");
    expect(reviewView(job("queued", false))).toBe("working");
    expect(reviewView(job("running", false))).toBe("working");
    expect(reviewView(job("ready"))).toBe("review");
    expect(reviewView(job("partial"))).toBe("review");
    for (const state of ["stalled", "failed"] as const) expect(reviewView(job(state, false))).toBe("trouble");
    expect(reviewView(job("partial", false))).toBe("trouble"); // nothing to review yet
  });
});

describe("initialPicks", () => {
  it("selects every piece of evidence except CV excerpts", () => {
    expect(initialPicks(draft)).toEqual([paper.id, pasted.id]);
  });
});

describe("acceptBody", () => {
  it("sends the trimmed bio, the edited expertise and the picked evidence in draft order, versions unchanged", () => {
    const body = acceptBody(draft, { bio: draft.bio, expertise: ["Qubit calibration", "Cryogenics"], picks: [cv.id, paper.id] });
    expect(body).toEqual({
      draftVersion: 2, baseTextVersion: 5, bio: "I calibrate qubits.",
      expertise: ["Qubit calibration", "Cryogenics"], evidenceIds: [paper.id, cv.id],
    });
    expect(AcceptEnrichment.safeParse(body).success).toBe(true);
  });
});

describe("claimsWithoutEvidence", () => {
  const all = ["Qubit calibration", "Lab safety"];

  it("says nothing until the person unticks something, even though CV excerpts start unticked", () => {
    expect(claimsWithoutEvidence(draft, initialPicks(draft), all)).toEqual({ bio: false, expertise: [] });
    expect(claimsWithoutEvidence(draft, [...initialPicks(draft), cv.id], all)).toEqual({ bio: false, expertise: [] });
  });

  it("flags the bio and kept expertise once evidence behind them is unticked", () => {
    expect(claimsWithoutEvidence(draft, [pasted.id], all)).toEqual({ bio: true, expertise: ["Qubit calibration"] });
    expect(claimsWithoutEvidence(draft, [pasted.id, cv.id], all)).toEqual({ bio: true, expertise: ["Qubit calibration"] });
    expect(claimsWithoutEvidence(draft, [pasted.id], ["Lab safety"])).toEqual({ bio: true, expertise: [] }); // a removed label isn't flagged
  });
});

describe("hiddenFacts", () => {
  const person: Person = {
    ...structuredClone(people[0]), workplaceName: "Analytical Engines",
    filters: { country: "GB", rorId: null, hiring: true }, visibility: { country: false, workplace: false, hiring: false },
  };

  it("names each hidden fact the text mentions, whatever the case", () => {
    expect(hiddenFacts("Based in the united kingdom at ANALYTICAL ENGINES, and we're hiring.", person)).toEqual([
      "your country (United Kingdom)", "your workplace (Analytical Engines)", "that you're hiring",
    ]);
    expect(hiddenFacts("I calibrate qubits.", person)).toEqual([]);
  });

  it("says nothing about facts that are shown", () => {
    const shown = { ...person, visibility: { country: true, workplace: true, hiring: true } };
    expect(hiddenFacts("United Kingdom, Analytical Engines, hiring", shown)).toEqual([]);
    expect(hiddenFacts("United Kingdom, Analytical Engines, hiring", { ...person, visibility: undefined })).toEqual([]);
  });
});

describe("evidenceTitle", () => {
  it("calls pasted profile text what the person did", () => {
    expect(evidenceTitle(pasted)).toBe("Text you pasted");
    expect(evidenceTitle(paper)).toBe(paper.title);
  });
});

describe("acceptProblem", () => {
  it("explains each refusal and what to do next", () => {
    expect(acceptProblem({ status: 409, code: "text_changed" }).action).toBe("keep"); // their newer words win
    expect(acceptProblem({ status: 409, code: "draft_superseded" }).action).toBe("reload");
    expect(acceptProblem({ status: 409, code: "consent_changed" }).action).toBe("reload");
    expect(acceptProblem({ status: 401, code: "sign_in_required" }).action).toBe("signin");
    expect(acceptProblem({ status: 0, code: null }).action).toBe("retry");
    expect(acceptProblem({ status: 503, code: null }).message).not.toMatch(/error|exception|stack/i);
  });
});

describe("carrying edits to a newer draft", () => {
  const github = evidence("repo:1", "github", { kind: "repo" });
  const newer: Draft = { ...draft, draftVersion: 3, bio: "A newer draft bio.", expertise: [{ label: "Newer topic", evidenceIds: [paper.id] }],
    evidence: [paper, cv, github] }; // the pasted text is gone, a GitHub repo is new
  const keep = (edits: Parameters<typeof keepEdits>[2]) => keepEdits("job1", draft, edits, null);

  it("starts from the draft when nothing was kept, CV excerpts unticked", () => {
    expect(carryEdits(draft, null)).toEqual({ bio: draft.bio, expertise: ["Qubit calibration", "Lab safety"], picks: [paper.id, pasted.id] });
  });

  it("keeps edited bio and expertise, and follows the newer draft where nothing was edited", () => {
    const edited = keep({ bio: "My words.", expertise: ["Mine"], picks: [paper.id] });
    expect(carryEdits(newer, edited)).toMatchObject({ bio: "My words.", expertise: ["Mine"] });
    const untouched = keep({ bio: draft.bio, expertise: ["Qubit calibration", "Lab safety"], picks: [paper.id] });
    expect(untouched).not.toHaveProperty("bio");
    expect(carryEdits(newer, untouched)).toMatchObject({ bio: "A newer draft bio.", expertise: ["Newer topic"] });
  });

  it("keeps picks only for evidence still in the draft; unseen evidence starts as usual", () => {
    // paper unticked, CV ticked, pasted ticked (then gone): GitHub is new, so ticked.
    const kept = keep({ bio: draft.bio, expertise: [], picks: [cv.id, pasted.id] });
    expect(carryEdits(newer, kept).picks).toEqual([cv.id, github.id]);
    const newCv = evidence("cv:2", "cv", { kind: "cv" });
    expect(carryEdits({ ...newer, evidence: [...newer.evidence, newCv] }, kept).picks).not.toContain(newCv.id);
  });

  it("remembers evidence seen in earlier drafts of the same import only", () => {
    const first = keep({ bio: draft.bio, expertise: [], picks: [] });
    const second = keepEdits("job1", newer, { bio: newer.bio, expertise: [], picks: [] }, first);
    expect(second.seen).toEqual(expect.arrayContaining([pasted.id, github.id]));
    expect(keepEdits("job2", newer, { bio: newer.bio, expertise: [], picks: [] }, first).seen).not.toContain(pasted.id);
  });

  it("reads back only this import's edits, and survives blocked or corrupt storage", () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) });
    const kept = keep({ bio: "Mine", expertise: [], picks: [] });
    saveKept(kept);
    expect(readKept("job1")).toEqual(kept);
    expect(readKept("job2")).toBeNull();
    memory.set("convo_enrichment_review", "{not json");
    expect(readKept("job1")).toBeNull();
    saveKept(null);
    expect(memory.size).toBe(0);
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(readKept("job1")).toBeNull();
    expect(() => saveKept(kept)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
