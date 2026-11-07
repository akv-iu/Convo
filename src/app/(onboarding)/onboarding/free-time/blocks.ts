/**
 * Half-hour blocks across the conference day, in the venue's time zone
 * (Salt Lake City, Mountain Time), and how picked blocks become the
 * TimeBlock list sent with PUT /api/availability.
 *
 * Times are built and labelled from numbers, never from the browser's
 * locale or time zone, so the server and the browser always show the same
 * labels (no hydration mismatch) and someone travelling sees venue time.
 */
import { CONFERENCE_DAY } from "@/contracts/fixtures";
import type { TimeBlock } from "@/contracts/types";

/** Venue offset on the conference day (MST, UTC-7). */
export const VENUE_OFFSET = "-07:00";
export const VENUE_LABEL = "Salt Lake City time";

export const DAY_START = 8 * 60; // 08:00
export const DAY_END = 18 * 60; // 18:00
export const STEP = 30;

export interface Block {
  /** Minutes from midnight, venue time. */
  from: number;
  to: number;
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function iso(day: string, minutes: number): string {
  return `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${VENUE_OFFSET}`;
}

export function blocksForDay(day: string = CONFERENCE_DAY): Block[] {
  const blocks: Block[] = [];
  for (let m = DAY_START; m < DAY_END; m += STEP) {
    blocks.push({ from: m, to: m + STEP, start: iso(day, m), end: iso(day, m + STEP) });
  }
  return blocks;
}

/** "9:00", "12:30", "1:00" (12-hour, no am/pm). */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(minutes % 60)}`;
}

/** "9 AM", "12 PM", "1 PM". */
export function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

/** "9:00 AM", "1:30 PM". */
export function timeLabel(minutes: number): string {
  return `${clock(minutes)} ${Math.floor(minutes / 60) < 12 ? "AM" : "PM"}`;
}

/** Indexes of the blocks fully covered by any saved interval (saved times may use any offset). */
export function pickedFromSaved(blocks: Block[], saved: TimeBlock[]): Set<number> {
  const spans = saved.map((s) => [Date.parse(s.start), Date.parse(s.end)] as const);
  const picked = new Set<number>();
  blocks.forEach((b, i) => {
    const start = Date.parse(b.start);
    const end = Date.parse(b.end);
    if (spans.some(([s, e]) => s <= start && e >= end)) picked.add(i);
  });
  return picked;
}

/**
 * The parts of saved times the grid can't show: other days, before 8:00 or
 * after 18:00, and anything that isn't a whole half hour. PUT replaces the
 * whole list, so these are sent back unchanged with the picks; a save from
 * this screen never deletes them. Boundaries keep the saved text.
 */
export function hiddenFromGrid(blocks: Block[], saved: TimeBlock[]): TimeBlock[] {
  const out: TimeBlock[] = [];
  for (const s of saved) {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    const inside = blocks
      .filter((b) => Date.parse(b.start) >= start && Date.parse(b.end) <= end)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    let cursor = { at: start, text: s.start };
    for (const b of inside) {
      if (Date.parse(b.start) > cursor.at) out.push({ start: cursor.text, end: b.start });
      if (Date.parse(b.end) > cursor.at) cursor = { at: Date.parse(b.end), text: b.end };
    }
    if (cursor.at < end) out.push({ start: cursor.text, end: s.end });
  }
  return out;
}

/** Runs of neighbouring picked blocks, as minutes. */
export function runs(blocks: Block[], picked: Set<number>): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  blocks.forEach((b, i) => {
    if (!picked.has(i)) return;
    const last = out[out.length - 1];
    if (last && last.to === b.from) last.to = b.to;
    else out.push({ from: b.from, to: b.to });
  });
  return out;
}

/** One interval per run of picked blocks. */
export function toTimeBlocks(blocks: Block[], picked: Set<number>, day: string = CONFERENCE_DAY): TimeBlock[] {
  return runs(blocks, picked).map((r) => ({ start: iso(day, r.from), end: iso(day, r.to) }));
}

/** The PUT /api/availability body: the picks plus the saved times the grid can't show, in time order. */
export function availabilityBody(blocks: Block[], picked: Set<number>, hidden: TimeBlock[]): TimeBlock[] {
  return [...hidden, ...toTimeBlocks(blocks, picked)].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** "9:00 AM – 10:30 AM" for each run. */
export function runLabels(blocks: Block[], picked: Set<number>): string[] {
  return runs(blocks, picked).map((r) => `${timeLabel(r.from)} – ${timeLabel(r.to)}`);
}

/** Total free time, e.g. "2½ hours", "30 minutes". */
export function totalLabel(picked: Set<number>): string {
  const minutes = picked.size * STEP;
  if (minutes === 0) return "No free time yet";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const half = minutes % 60 ? "½" : "";
  return `${hours}${half} hour${hours === 1 && !half ? "" : "s"}`;
}

/** Quick picks, in venue minutes. */
export const presets = [
  { id: "morning", label: "Morning", from: 9 * 60, to: 12 * 60 },
  { id: "lunch", label: "Lunch", from: 12 * 60, to: 13 * 60 + 30 },
  { id: "afternoon", label: "Afternoon", from: 13 * 60 + 30, to: 17 * 60 + 30 },
  { id: "all", label: "All day", from: DAY_START, to: DAY_END },
] as const;

export function blocksIn(blocks: Block[], from: number, to: number): number[] {
  return blocks.flatMap((b, i) => (b.from >= from && b.to <= to ? [i] : []));
}

export function sameSet(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((v) => b.has(v));
}
