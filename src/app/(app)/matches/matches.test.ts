import { describe, expect, it } from "vitest";
import type { MatchResult } from "@/contracts/types";
import {
  badgeLabels,
  cardColour,
  highlightParts,
  matchFailure,
  passFailure,
  sendFailure,
  SWIPE_DISTANCE,
  swipeOutcome,
  withinCutoff,
} from "./matches";

function match(over: Partial<MatchResult> & { rank: number }, person: Partial<MatchResult["person"]> = {}): MatchResult {
  return {
    highlights: [],
    badges: [],
    mutual: false,
    explanation: "Maintains etcd's Raft library",
    score: 1,
    ...over,
    person: {
      id: `p${over.rank}`,
      name: "Ada",
      githubLogin: "ada",
      bio: "",
      languages: [],
      organisations: [],
      filters: { country: "GB", rorId: null, hiring: true },
      synthetic: false,
      freeTimes: [],
      ...person,
    },
  };
}

describe("swipeOutcome", () => {
  it("sends on a long right drag, passes on a long left drag, and snaps back otherwise", () => {
    expect(swipeOutcome(SWIPE_DISTANCE)).toBe("send");
    expect(swipeOutcome(-SWIPE_DISTANCE - 5)).toBe("pass");
    expect(swipeOutcome(40)).toBeNull();
    expect(swipeOutcome(-40)).toBeNull();
  });
});

describe("highlightParts", () => {
  it("marks <em> hits and keeps the rest as plain text", () => {
    expect(highlightParts("leader <em>election</em> in <em>Raft</em>")).toEqual([
      { text: "leader ", hit: false },
      { text: "election", hit: true },
      { text: " in ", hit: false },
      { text: "Raft", hit: true },
    ]);
  });

  it("keeps code-like text with angle brackets as written (React renders it as text)", () => {
    expect(highlightParts("Option<T> and Vec<u8> in <em>serde</em>")).toEqual([
      { text: "Option<T> and Vec<u8> in ", hit: false },
      { text: "serde", hit: true },
    ]);
    expect(highlightParts('<img src=x onerror="alert(1)">')).toEqual([{ text: '<img src=x onerror="alert(1)">', hit: false }]);
    expect(highlightParts("plain title")).toEqual([{ text: "plain title", hit: false }]);
  });

  it("treats an unclosed <em> as plain text", () => {
    expect(highlightParts("a <em>b")).toEqual([{ text: "a <em>b", hit: false }]);
    expect(highlightParts("")).toEqual([]);
  });
});

describe("cards", () => {
  it("use the person's badge colour, sunflower when they have none", () => {
    expect(cardColour(match({ rank: 0 }, { badgeColour: "lilac" }).person)).toBe("#c4b5fd");
    expect(cardColour(match({ rank: 0 }).person)).toBe("#ffd23f");
  });

  it("word the hard-filter badges, with synthetic shown separately", () => {
    expect(badgeLabels(match({ rank: 0, badges: ["hiring", "GB", "synthetic"] }))).toEqual(["Hiring", "United Kingdom"]);
  });

  it("never show a hidden hiring value as not hiring", () => {
    const hidden = match({ rank: 0, badges: ["not hiring", "US"] }, { filters: { country: "US", rorId: null, hiring: null } });
    expect(badgeLabels(hidden)).toEqual(["United States"]);
  });
});

describe("batch cutoff", () => {
  it("keeps only ranks strictly below the cutoff", () => {
    const list = [0, 1, 2, 3, 4].map((rank) => match({ rank }));
    expect(withinCutoff(list, 3).map((m) => m.rank)).toEqual([0, 1, 2]);
    expect(withinCutoff(list, null)).toHaveLength(5);
  });
});

describe("failures", () => {
  it("for matching: sign-in, someone else's ask, unfinished profile, and the server's retry message", () => {
    expect(matchFailure(401, null).action?.href).toBe("/signin");
    expect(matchFailure(404, null).action?.href).toBe("/ask");
    expect(matchFailure(409, null).action?.label).toBe("Set up your badge");
    expect(matchFailure(503, { error: "Search is busy" })).toEqual({ message: "Search is busy", action: null });
    expect(matchFailure(0, null).message).toMatch(/didn't load/);
  });

  it("for a pass: passes on the server's 'saved, don't resubmit' message, else says to refresh", () => {
    const saved = "Rejection saved, but the count could not be read. Do not resubmit.";
    expect(passFailure(503, { error: saved }).message).toBe(saved);
    expect(passFailure(0, null).message).toMatch(/Refresh the matches/);
    expect(passFailure(401, null).action?.label).toBe("Sign in again");
  });

  it("for a send: gone, sign-in, or may not have been sent", () => {
    expect(sendFailure(404, null).message).toMatch(/isn't available/);
    expect(sendFailure(401, null).action?.label).toBe("Sign in again");
    expect(sendFailure(503, null).message).toMatch(/may not have been sent/);
  });
});
