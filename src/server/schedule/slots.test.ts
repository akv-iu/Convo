import { describe, expect, it } from "vitest";
import { findSlots } from "./slots";

const day = (from: string, to: string) => ({
  start: `2026-11-09T${from}:00-07:00`,
  end: `2026-11-09T${to}:00-07:00`,
});
const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-07:00`);
const base = { minutes: 15, lockoutMinutes: 60, max: 3 };

describe("findSlots", () => {
  it("merges duplicated, overlapping and adjacent availability before finding slots", () => {
    const a = [day("13:10", "13:20"), day("13:00", "13:10"), day("13:00", "13:10")];
    const b = [day("13:00", "13:15"), day("13:05", "13:30")];
    const original = structuredClone(a);
    expect(findSlots(a, b, { ...base, now: at("08:00") })).toEqual([
      { start: at("13:00").toISOString(), end: at("13:15").toISOString() },
    ]);
    expect(a).toEqual(original);
  });

  it("allows bookings that touch a free interval boundary without overlapping", () => {
    expect(findSlots([day("13:00", "13:15")], [day("13:00", "13:15")], {
      ...base, now: at("08:00"), booked: [day("12:45", "13:00"), day("13:15", "13:30")],
    })).toEqual([{ start: at("13:00").toISOString(), end: at("13:15").toISOString() }]);
  });

  it("returns the overlap of both people's free times", () => {
    const slots = findSlots([day("13:00", "14:30")], [day("13:30", "15:00")], { ...base, now: at("08:00") });
    expect(slots).toEqual([{ start: at("13:30").toISOString(), end: at("13:45").toISOString() }]);
  });

  it("never suggests a slot less than an hour away", () => {
    const slots = findSlots([day("13:00", "14:30")], [day("13:00", "14:30")], { ...base, now: at("13:10") });
    expect(slots[0].start).toBe(at("14:10").toISOString());
  });

  it("drops overlaps too short for the meeting", () => {
    const slots = findSlots([day("13:00", "13:10")], [day("13:00", "14:00")], { ...base, now: at("08:00") });
    expect(slots).toEqual([]);
  });

  it("skips times already booked", () => {
    const slots = findSlots([day("13:00", "14:00")], [day("13:00", "14:00")], {
      ...base,
      now: at("08:00"),
      booked: [day("13:00", "13:30")],
    });
    expect(slots[0].start).toBe(at("13:30").toISOString());
  });

  it("returns nothing when there is no overlap", () => {
    expect(findSlots([day("09:00", "10:00")], [day("11:00", "12:00")], { ...base, now: at("08:00") })).toEqual([]);
  });

  it("caps the number of slots", () => {
    const a = [day("09:00", "09:30"), day("10:00", "10:30"), day("11:00", "11:30"), day("12:00", "12:30")];
    expect(findSlots(a, a, { ...base, now: at("07:00") })).toHaveLength(3);
  });
});
