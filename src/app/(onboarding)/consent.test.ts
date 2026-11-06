import { describe, expect, it } from "vitest";
import { consentSources as backendIds } from "@/server/profile/consent";
import { CONSENT_COOKIE, consentSources } from "./consent";

describe("sign-in consent wording", () => {
  it("offers exactly the sources the backend enforces, in the same order", () => {
    expect(consentSources.map((s) => s.id)).toEqual([...backendIds]);
  });

  it("uses the cookie the backend reads", () => {
    expect(CONSENT_COOKIE).toBe("convo_consent");
  });

  it("gives every source a label and a hint", () => {
    for (const s of consentSources) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
    }
  });
});
