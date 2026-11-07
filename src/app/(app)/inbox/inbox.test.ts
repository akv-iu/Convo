import { describe, expect, it } from "vitest";
import type { Request } from "@/contracts/types";
import {
  badgeColour,
  badgeFacts,
  bookFailure,
  inboxFailure,
  inboxOrder,
  REPLY_MAX,
  replyProblem,
  respondFailure,
  sentStatusLabel,
  slotsFailure,
  statusLabel,
  venueRange,
  venueTime,
} from "./inbox";

const req = (id: string, status: Request["status"]): Request => ({
  id,
  askId: "a",
  fromUserId: "u",
  toPersonId: "me",
  question: "q",
  minutes: 10,
  status,
  reply: null,
  slot: null,
  createdAt: "2026-11-09T16:42:00Z",
});

describe("replyProblem", () => {
  it("needs some text, within the limit", () => {
    expect(replyProblem("  ")).toMatch(/short reply/);
    expect(replyProblem("Happy to — see my talk at 2pm")).toBeNull();
    expect(replyProblem("x".repeat(REPLY_MAX + 1))).toMatch(/under 500/);
  });
});

describe("labels and times", () => {
  it("names every status", () => {
    expect(Object.keys(statusLabel).sort()).toEqual(["accepted", "answered", "declined", "scheduled", "sent"]);
  });

  it("shows times in venue time (Salt Lake City), whatever the offset", () => {
    expect(venueTime("2026-11-09T16:42:00Z")).toBe("Mon 9 Nov, 9:42 AM");
    expect(venueTime("2026-11-09T09:42:00-07:00")).toBe("Mon 9 Nov, 9:42 AM");
    expect(venueRange({ start: "2026-11-09T16:00:00Z", end: "2026-11-09T16:15:00Z" })).toBe("Mon 9 Nov, 9:00 AM – 9:15 AM");
    expect(venueTime("not a date")).toBe("");
  });
});

describe("failures", () => {
  it("a failed inbox load is an error with sign-in or Try again, never empty", () => {
    expect(inboxFailure(401).action?.label).toBe("Sign in again");
    expect(inboxFailure(503)).toEqual({ message: expect.stringMatching(/didn't load/), action: null });
  });

  it("a failed answer explains each case and never suggests a blind retry", () => {
    expect(respondFailure(403, null).message).toMatch(/Only the person/);
    expect(respondFailure(404, null).message).toMatch(/no longer exists/);
    expect(respondFailure(400, null).message).toMatch(/wasn't accepted/);
    expect(respondFailure(401, null).action?.href).toBe("/signin");
    expect(respondFailure(503, { error: "Saved? Check the inbox first." }).message).toBe("Saved? Check the inbox first.");
    expect(respondFailure(0, null).message).toMatch(/Reload your requests to check/);
  });
});

describe("inboxOrder", () => {
  it("puts new requests first and otherwise keeps the API's newest-first order", () => {
    const ordered = inboxOrder([req("1", "accepted"), req("2", "sent"), req("3", "declined"), req("4", "sent")]);
    expect(ordered.map((r) => r.id)).toEqual(["2", "4", "1", "3"]);
  });
});

describe("booking failures (A2 step 5)", () => {
  it("a taken or stale time (409) loads fresh times; a 503 says to check before booking again", () => {
    expect(bookFailure(409, null).message).toMatch(/Showing what's free now/);
    expect(bookFailure(503, null).message).toMatch(/Reload your requests to check/);
    expect(bookFailure(503, { error: "Booking saved, but the reply was unreadable." }).message).toBe("Booking saved, but the reply was unreadable.");
    expect(bookFailure(403, null).message).toMatch(/no longer yours/);
    expect(bookFailure(401, null).action?.label).toBe("Sign in again");
  });

  it("explains a failed slot load", () => {
    expect(slotsFailure(404, null).message).toMatch(/no longer yours/);
    expect(slotsFailure(401, null).action?.href).toBe("/signin");
    expect(slotsFailure(503, null).message).toMatch(/didn't load/);
  });
});

describe("the other person's badge on a request", () => {
  const person = {
    id: "p1", name: "Ada", githubLogin: "ada", bio: "", languages: [], organisations: [], synthetic: false, freeTimes: [],
    workplaceName: "Acme Robotics", filters: { country: "GB", rorId: null, hiring: true },
  };

  it("lists workplace, country and hiring, leaving out sections the person hid", () => {
    expect(badgeFacts(person)).toEqual(["Acme Robotics", "United Kingdom", "Hiring"]);
    expect(badgeFacts({ ...person, filters: { ...person.filters, hiring: false } })).toContain("Not hiring");
    // Hidden sections arrive as null: a hidden hiring answer is never shown as "Not hiring".
    expect(badgeFacts({ ...person, workplaceName: null, filters: { country: null, rorId: null, hiring: null } })).toEqual([]);
  });

  it("uses the person's colour, and sunflower when they have none or can't be found", () => {
    expect(badgeColour({ ...person, badgeColour: "lilac" })).toBe("#c4b5fd");
    expect(badgeColour(person)).toBe("#ffd23f");
    expect(badgeColour(null)).toBe("#ffd23f");
  });

  it("words every status from the asker's side", () => {
    expect(sentStatusLabel.sent).toBe("Waiting for an answer");
    expect(Object.keys(sentStatusLabel).sort()).toEqual(Object.keys(statusLabel).sort());
  });
});
