import { describe, expect, it } from "vitest";
import type { RequestView } from "@/contracts/types";
import { groupByQuestion, groupSummary } from "./inbox";

const view = (id: string, askId: string, createdAt: string, status: RequestView["status"] = "sent"): RequestView => ({
  id, askId, fromUserId: "me", toPersonId: `p-${id}`, question: `Question ${askId}`, minutes: 5, status,
  reply: null, slot: null, createdAt, type: "knowledge", person: null,
});

describe("groupByQuestion", () => {
  it("puts each question's requests together, newest question first, people in the order sent", () => {
    const groups = groupByQuestion([
      view("r1", "a", "2026-11-07T10:00:00Z"),
      view("r2", "b", "2026-11-07T11:00:00Z"),
      view("r3", "a", "2026-11-07T12:00:00Z"),
    ]);
    expect(groups.map((g) => [g.askId, g.requests.map((r) => r.id), g.latest])).toEqual([
      ["a", ["r1", "r3"], "2026-11-07T12:00:00Z"],
      ["b", ["r2"], "2026-11-07T11:00:00Z"],
    ]);
    expect(groups[0]).toMatchObject({ question: "Question a", type: "knowledge", minutes: 5 });
  });

  it("is empty for no requests", () => {
    expect(groupByQuestion([])).toEqual([]);
  });
});

describe("groupSummary", () => {
  it("says how many people and where they stand, in a fixed order", () => {
    expect(groupSummary([{ status: "sent" }])).toBe("1 person · 1 waiting");
    expect(
      groupSummary([{ status: "sent" }, { status: "answered" }, { status: "sent" }, { status: "scheduled" }, { status: "declined" }, { status: "accepted" }]),
    ).toBe("6 people · 1 meeting booked · 1 accepted · 1 replied · 1 declined · 2 waiting");
  });
});
