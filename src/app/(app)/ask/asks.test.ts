import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routes } from "@/contracts/routes";
import { ASK_MAX, askProblem, lengthLabel, lookingLabel, recallAsk, refineFailure, rememberAsk, typeLabel } from "./asks";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

const refined = { text: "How does Raft leader election work?", type: "knowledge" as const, minutes: 10 };

describe("askProblem", () => {
  it("asks for a few words when the box is empty or too short", () => {
    expect(askProblem("")).toMatch(/few words/);
    expect(askProblem("  hi ")).toMatch(/few words/);
  });

  it("accepts what the API accepts, and refuses overlong text", () => {
    expect(askProblem("how does Raft vote")).toBeNull();
    expect(routes.refine.body.safeParse({ text: "abc" }).success).toBe(true);
    expect(askProblem("abc")).toBeNull();
    expect(askProblem("x".repeat(ASK_MAX + 1))).toMatch(/under 500/);
  });
});

describe("labels", () => {
  it("names every ask type and the meeting length", () => {
    expect(Object.keys(typeLabel).sort()).toEqual(["career", "collaboration", "hiring", "knowledge"]);
    expect(lengthLabel(15)).toBe("15-minute chat");
  });
});

describe("refineFailure", () => {
  it("shows a blocked ask's message as the server wrote it", () => {
    const msg = "This question can't be sent because it looks offensive or unsafe. Please rephrase it.";
    expect(refineFailure(422, { error: msg })).toEqual({ message: msg, action: null });
  });

  it("sends people who haven't finished setting up back to it", () => {
    expect(refineFailure(409, { error: "Complete onboarding first." }).action).toEqual({ label: "Set up your badge", href: "/signin" });
  });

  it("offers sign-in for 401 and 404", () => {
    expect(refineFailure(401, null).action?.label).toBe("Sign in again");
    expect(refineFailure(404, null).action?.label).toBe("Sign in again");
  });

  it("passes on a 503's retry message, with fallbacks for other failures", () => {
    expect(refineFailure(503, { error: "Search is busy. Try again." }).message).toBe("Search is busy. Try again.");
    expect(refineFailure(503, null).message).toMatch(/try again/i);
    expect(refineFailure(400, null).message).toMatch(/few words/);
    expect(refineFailure(0, null)).toEqual({ message: expect.stringMatching(/try again/i), action: null });
  });
});

describe("remembered asks (this tab only)", () => {
  beforeEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it("recalls a refined ask by its ID", () => {
    rememberAsk({ askId: "a1", rawText: "raft voting", refined });
    expect(recallAsk("a1")).toEqual({ askId: "a1", rawText: "raft voting", refined });
    expect(recallAsk("other")).toBeNull();
  });

  it("keeps the newest 10, newest first, without duplicates", () => {
    for (let i = 0; i < 12; i++) rememberAsk({ askId: `a${i}`, rawText: `q${i}`, refined });
    rememberAsk({ askId: "a11", rawText: "again", refined });
    expect(recallAsk("a0")).toBeNull();
    expect(recallAsk("a1")).toBeNull();
    expect(recallAsk("a2")?.rawText).toBe("q2");
    expect(recallAsk("a11")?.rawText).toBe("again");
  });

  it("ignores broken storage, and copes with none", () => {
    sessionStorage.setItem("convo_asks", "{broken");
    expect(recallAsk("a1")).toBeNull();
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => rememberAsk({ askId: "a1", rawText: "x", refined })).not.toThrow();
    expect(recallAsk("a1")).toBeNull();
  });
});

describe("lookingLabel (A1 step 6)", () => {
  it("words none, one and many", () => {
    expect(lookingLabel(0)).toEqual({ number: "No one", text: "is asking for someone like you yet. Check back later." });
    expect(lookingLabel(1)).toEqual({ number: "1", text: "person here is looking for someone like you" });
    expect(lookingLabel(1234)).toEqual({ number: "1,234", text: "people here are looking for someone like you" });
  });
});
