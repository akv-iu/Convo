import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Person } from "@/contracts/types";
import { narrowTo, readNarrowing, showsCountry, showsPlace } from "./narrow";

const person = (over: Partial<Person>): Person => ({ ...structuredClone(people[0]), languages: [], organisations: [], ...over });
const oxford = person({ id: "ox", workplaceName: "University of Oxford", organisations: ["kubernetes"], languages: ["Rust"], filters: { country: "GB", rorId: null, hiring: true } });
const grafana = person({ id: "gr", workplaceName: "Grafana Labs", languages: ["Go"], filters: { country: "ES", rorId: null, hiring: false } });
const hidden = person({ id: "hd", workplaceName: "University of Leeds", filters: { country: "ES", rorId: null, hiring: false }, visibility: { country: false, workplace: false, hiring: true } });
const expert = person({ id: "ex", workplaceName: null, organisations: ["kubernetes-sigs"], languages: ["Go"], filters: { country: "US", rorId: null, hiring: true } });

describe("reading the person finder", () => {
  it("finds a country by name, any case, and keeps the rest", () => {
    expect(readNarrowing("Spain")).toMatchObject({ country: "ES", rest: "" });
    expect(readNarrowing("rust engineers in united kingdom")).toMatchObject({ country: "GB", rest: "rust engineers in" });
    expect(readNarrowing("Rust")).toMatchObject({ country: null, rest: "Rust" });
    expect(readNarrowing("")).toMatchObject({ country: null, rest: "" });
  });
});

describe("matching what a person shows", () => {
  it("matches workplaces, organisations and skills as whole words", () => {
    expect(showsPlace(oxford, "University")).toBe(true);
    expect(showsPlace(oxford, "university of oxford")).toBe(true);
    expect(showsPlace(oxford, "Kubernetes")).toBe(true);
    expect(showsPlace(oxford, "rust")).toBe(true);
    expect(showsPlace(grafana, "Go")).toBe(true); // a skill
    expect(showsPlace(oxford, "Go")).toBe(false); // not a word inside "Oxford" or anything else
    expect(showsPlace(oxford, "people at University of Oxford")).toBe(true); // linking words don't have to match
  });

  it("never matches what a person hid", () => {
    expect(showsCountry(hidden, "ES")).toBe(false);
    expect(showsPlace(hidden, "University")).toBe(false);
    expect(showsCountry(grafana, "ES")).toBe(true);
  });
});

describe("the person finder is a strict filter", () => {
  const all = [oxford, grafana, hidden, expert];
  const ids = (q: string) => all.filter(narrowTo(readNarrowing(q))).map((p) => p.id);

  it("keeps only people who fit everything named", () => {
    expect(ids("Spain")).toEqual(["gr"]);
    expect(ids("University")).toEqual(["ox"]);
    expect(ids("Grafana Labs")).toEqual(["gr"]);
    expect(ids("Go")).toEqual(["gr", "ex"]);
    expect(ids("Go spain")).toEqual(["gr"]);
    expect(ids("University spain")).toEqual([]); // both must hold
  });

  it("shows no one rather than falling back when no one fits", () => {
    expect(ids("university of utah")).toEqual([]);
    expect(ids("Haskell")).toEqual([]);
  });

  it("keeps everyone when the box is empty", () => {
    expect(ids("")).toEqual(["ox", "gr", "hd", "ex"]);
  });
});

describe("a workplace with a country in its name", () => {
  it("fits as the workplace, while a bare country is still the country", () => {
    const georgia = person({ id: "ga", workplaceName: "University of Georgia", filters: { country: "US", rorId: null, hiring: true } });
    const all = [georgia, grafana];
    const ids = (q: string) => all.filter(narrowTo(readNarrowing(q))).map((p) => p.id);
    expect(ids("University of Georgia")).toEqual(["ga"]);
    expect(ids("Georgia")).toEqual([]); // nobody shows the country Georgia
  });
});
