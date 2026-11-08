import { describe, expect, it } from "vitest";
import { sharedContact } from "./contact-share";

const details = { email: "ana@example.com", phone: "+44 7700 900123", share: "email" as const };

describe("sharedContact", () => {
  it("shares nothing until the request is agreed", () => {
    for (const status of ["sent", "declined", "answered"] as const) expect(sharedContact(details, status)).toBeNull();
  });

  it("shares only what the person chose, once accepted or booked", () => {
    expect(sharedContact(details, "accepted")).toEqual({ email: "ana@example.com", phone: null });
    expect(sharedContact({ ...details, share: "phone" }, "scheduled")).toEqual({ email: null, phone: "+44 7700 900123" });
    expect(sharedContact({ ...details, share: "both" }, "accepted")).toEqual({ email: "ana@example.com", phone: "+44 7700 900123" });
  });

  it("gives null when the chosen detail is missing, or there are no details", () => {
    expect(sharedContact({ ...details, share: "phone", phone: null }, "accepted")).toBeNull();
    expect(sharedContact(undefined, "accepted")).toBeNull();
  });
});
