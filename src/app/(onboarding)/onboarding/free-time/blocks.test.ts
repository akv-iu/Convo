import { describe, expect, it } from "vitest";
import { routes } from "@/contracts/routes";
import { block, people } from "@/contracts/fixtures";
import {
  availabilityBody,
  blocksForDay,
  blocksIn,
  clock,
  hiddenFromGrid,
  hourLabel,
  pickedFromSaved,
  presets,
  runLabels,
  sameSet,
  timeLabel,
  toTimeBlocks,
  totalLabel,
} from "./blocks";

const blocks = blocksForDay("2026-11-09");

describe("blocksForDay", () => {
  it("covers 8:00 to 18:00 in half hours, in venue time", () => {
    expect(blocks).toHaveLength(20);
    expect(blocks[0]).toMatchObject({ start: "2026-11-09T08:00:00-07:00", end: "2026-11-09T08:30:00-07:00" });
    expect(blocks.at(-1)).toMatchObject({ start: "2026-11-09T17:30:00-07:00", end: "2026-11-09T18:00:00-07:00" });
  });
});

describe("labels", () => {
  it("uses 12-hour venue times", () => {
    expect(clock(9 * 60)).toBe("9:00");
    expect(clock(12 * 60 + 30)).toBe("12:30");
    expect(hourLabel(13 * 60)).toBe("1 PM");
    expect(hourLabel(12 * 60)).toBe("12 PM");
    expect(timeLabel(8 * 60 + 30)).toBe("8:30 AM");
  });

  it("describes the total", () => {
    expect(totalLabel(new Set())).toBe("No free time yet");
    expect(totalLabel(new Set([0]))).toBe("30 minutes");
    expect(totalLabel(new Set([0, 1]))).toBe("1 hour");
    expect(totalLabel(new Set([0, 1, 2]))).toBe("1½ hours");
    expect(totalLabel(new Set([0, 1, 2, 3]))).toBe("2 hours");
  });
});

describe("toTimeBlocks", () => {
  it("joins neighbouring picks into one interval per run", () => {
    const picked = new Set([2, 3, 4, 10, 11]); // 9:00-10:30 and 13:00-14:00
    const body = toTimeBlocks(blocks, picked, "2026-11-09");
    expect(body).toEqual([
      { start: "2026-11-09T09:00:00-07:00", end: "2026-11-09T10:30:00-07:00" },
      { start: "2026-11-09T13:00:00-07:00", end: "2026-11-09T14:00:00-07:00" },
    ]);
    expect(routes.putAvailability.body.parse(body)).toEqual(body);
    expect(runLabels(blocks, picked)).toEqual(["9:00 AM – 10:30 AM", "1:00 PM – 2:00 PM"]);
  });

  it("sends an empty list when nothing is picked (clears free times)", () => {
    expect(toTimeBlocks(blocks, new Set(), "2026-11-09")).toEqual([]);
  });
});

describe("pickedFromSaved", () => {
  it("marks blocks a saved interval fully covers, in any offset", () => {
    const saved = [{ start: "2026-11-09T16:00:00Z", end: "2026-11-09T17:15:00Z" }]; // 9:00-10:15 MT
    expect([...pickedFromSaved(blocks, saved)]).toEqual([2, 3]); // 9:00-9:30, 9:30-10:00; 10:00-10:30 only partly covered
  });

  it("round-trips the fixture user's free times", () => {
    const saved = people[0].freeTimes; // 9-10, 13-14:30, 16:30-17:30
    const picked = pickedFromSaved(blocks, saved);
    expect(toTimeBlocks(blocks, picked, "2026-11-09")).toEqual(saved);
    expect(saved[0]).toEqual(block("09:00", "10:00"));
  });
});

describe("presets", () => {
  it("pick the blocks inside each range", () => {
    const morning = presets.find((p) => p.id === "morning")!;
    expect(blocksIn(blocks, morning.from, morning.to)).toEqual([2, 3, 4, 5, 6, 7]);
    const all = presets.find((p) => p.id === "all")!;
    expect(blocksIn(blocks, all.from, all.to)).toHaveLength(20);
  });

  it("sameSet compares picks", () => {
    expect(sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameSet(new Set([1]), new Set([1, 2]))).toBe(false);
  });
});

describe("hiddenFromGrid (saved times the grid can't show are kept)", () => {
  const t = (start: string, end: string) => ({ start, end });

  it("keeps other days, early and late times whole, with their own text", () => {
    const saved = [
      t("2026-11-10T09:00:00-07:00", "2026-11-10T10:00:00-07:00"),
      t("2026-11-09T07:00:00-07:00", "2026-11-09T07:45:00-07:00"),
      t("2026-11-09T18:30:00-07:00", "2026-11-09T19:00:00-07:00"),
    ];
    expect(hiddenFromGrid(blocks, saved)).toEqual(saved);
  });

  it("keeps only the parts of an interval that don't fill whole half hours", () => {
    const saved = [t("2026-11-09T07:45:00-07:00", "2026-11-09T09:15:00-07:00")];
    expect(hiddenFromGrid(blocks, saved)).toEqual([
      t("2026-11-09T07:45:00-07:00", "2026-11-09T08:00:00-07:00"),
      t("2026-11-09T09:00:00-07:00", "2026-11-09T09:15:00-07:00"),
    ]);
    expect(pickedFromSaved(blocks, saved)).toEqual(new Set([0, 1])); // 8:00-9:00 shows on the grid
  });

  it("keeps nothing extra for times the grid shows exactly, in any offset", () => {
    expect(hiddenFromGrid(blocks, [t("2026-11-09T16:00:00Z", "2026-11-09T17:00:00Z")])).toEqual([]);
    expect(hiddenFromGrid(blocks, [])).toEqual([]);
  });

  it("a save sends the picks plus the hidden times, in time order, and the API accepts it", () => {
    const hidden = [t("2026-11-10T09:00:00-07:00", "2026-11-10T10:00:00-07:00"), t("2026-11-09T07:00:00-07:00", "2026-11-09T07:30:00-07:00")];
    const body = availabilityBody(blocks, new Set([2, 3]), hidden);
    expect(body).toEqual([
      t("2026-11-09T07:00:00-07:00", "2026-11-09T07:30:00-07:00"),
      t("2026-11-09T09:00:00-07:00", "2026-11-09T10:00:00-07:00"),
      t("2026-11-10T09:00:00-07:00", "2026-11-10T10:00:00-07:00"),
    ]);
    expect(routes.putAvailability.body.safeParse(body).success).toBe(true);
    // Clearing the grid still keeps what it can't show.
    expect(availabilityBody(blocks, new Set(), hidden)).toHaveLength(2);
  });
});
