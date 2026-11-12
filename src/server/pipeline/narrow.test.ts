import { describe, expect, it } from "vitest";
import { people } from "@/contracts/fixtures";
import type { Person } from "@/contracts/types";
import { narrowTo, readNarrowing, showsCountry, showsPlace } from "./narrow";

const person = (over: Partial<Person>): Person => ({ ...structuredClone(people[0]), ...over });
const oxford = person({ id: "ox", workplaceName: "University of Oxford", organisations: ["kubernetes"], filters: { country: "GB", rorId: null, hiring: true } });
const grafana = person({ id: "gr", workplaceName: "Grafana Labs", organisations: [], filters: { country: "ES", rorId: null, hiring: false } });
const hidden = person({ id: "hd", workplaceName: "University of Leeds", filters: { country: "ES", rorId: null, hiring: false }, visibility: { country: false, workplace: false, hiring: true } });

describe("reading the search box", () => {
  it("finds a country by name, any case, and keeps the rest", () => {
    expect(readNarrowing("Spain")).toMatchObject({ country: "ES", rest: "" });
    expect(readNarrowing("rust engineers in united kingdom")).toMatchObject({ country: "GB", rest: "rust engineers in" });
    expect(readNarrowing("Rust")).toMatchObject({ country: null, rest: "Rust" });
    expect(readNarrowing("")).toMatchObject({ country: null, rest: "" });
  });
});

describe("narrowing the list", () => {
  it("matches shown workplaces as whole words, but not GitHub organisations", () => {
    expect(showsPlace(oxford, "University")).toBe(true);
    expect(showsPlace(oxford, "university of oxford")).toBe(true);
    expect(showsPlace(oxford, "Kubernetes")).toBe(false); // an org name is a topic
    expect(showsPlace(grafana, "Go")).toBe(false); // not a word inside "Grafana"
  });

  it("never matches what a person hid", () => {
    expect(showsCountry(hidden, "ES")).toBe(false);
    expect(showsPlace(hidden, "University")).toBe(false);
    expect(showsCountry(grafana, "ES")).toBe(true);
  });

  it("narrows by country, by place when someone shows it, and leaves topics alone", () => {
    const all = [oxford, grafana, hidden];
    const ids = (q: string) => all.filter(narrowTo(all, readNarrowing(q))).map((p) => p.id);
    expect(ids("Spain")).toEqual(["gr"]);
    expect(ids("University")).toEqual(["ox"]);
    expect(ids("Grafana Labs")).toEqual(["gr"]);
    expect(ids("Rust")).toEqual(["ox", "gr", "hd"]); // a topic: searching handled it
    expect(ids("University spain")).toEqual([]); // both must hold
    expect(ids("Kubernetes")).toEqual(["ox", "gr", "hd"]); // oxford's org: still a topic, nobody dropped
  });

  it("reads a workplace with a country in its name as the workplace, but a bare country as the country", () => {
    const georgia = person({ id: "ga", workplaceName: "University of Georgia", organisations: [], filters: { country: "US", rorId: null, hiring: true } });
    const all = [georgia, grafana];
    const ids = (q: string) => all.filter(narrowTo(all, readNarrowing(q))).map((p) => p.id);
    expect(ids("University of Georgia")).toEqual(["ga"]);
    expect(ids("Georgia")).toEqual([]); // nobody shows the country Georgia
  });
});
