import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDraft, readDraft, saveDraft } from "./draft";

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

describe("onboarding draft", () => {
  beforeEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it("round-trips step 1's answers", () => {
    const draft = {
      name: "Ada Lovelace",
      country: "GB",
      workplace: { kind: "org" as const, org: { id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" } },
    };
    saveDraft(draft);
    expect(readDraft()).toEqual(draft);
    clearDraft();
    expect(readDraft()).toBeNull();
  });

  it("ignores missing, broken or invalid drafts", () => {
    expect(readDraft()).toBeNull();
    sessionStorage.setItem("convo_onboarding_draft", "{broken");
    expect(readDraft()).toBeNull();
    sessionStorage.setItem("convo_onboarding_draft", JSON.stringify({ name: "", country: "GB", workplace: null }));
    expect(readDraft()).toBeNull();
  });

  it("copes with storage being unavailable", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => saveDraft({ name: "A", country: "GB", workplace: { kind: "none" } })).not.toThrow();
    expect(readDraft()).toBeNull();
    expect(() => clearDraft()).not.toThrow();
  });
});
