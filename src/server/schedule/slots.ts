import type { Slot, TimeBlock } from "@/contracts/types";

export interface FindSlotsOptions {
  now: Date;
  /** Meeting length. */
  minutes: number;
  /** A slot never starts sooner than this. */
  lockoutMinutes: number;
  /** Times either person already has a meeting. */
  booked?: TimeBlock[];
  max?: number;
}

type Interval = { start: number; end: number };

const toInterval = (b: TimeBlock): Interval => ({
  start: Date.parse(b.start),
  end: Date.parse(b.end),
});

function merge(blocks: TimeBlock[]): Interval[] {
  const merged: Interval[] = [];
  for (const block of blocks.map(toInterval).sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && block.start <= previous.end) previous.end = Math.max(previous.end, block.end);
    else merged.push({ ...block });
  }
  return merged;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

function subtract(free: Interval[], booked: Interval[]): Interval[] {
  let result = free;
  for (const b of booked) {
    const next: Interval[] = [];
    for (const f of result) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f);
        continue;
      }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    result = next;
  }
  return result;
}

/**
 * The first few slots where both people's free times overlap for at least
 * `minutes`, none starting less than `lockoutMinutes` from now, skipping
 * anything already booked.
 */
export function findSlots(a: TimeBlock[], b: TimeBlock[], opts: FindSlotsOptions): Slot[] {
  const earliest = opts.now.getTime() + opts.lockoutMinutes * 60_000;
  const length = opts.minutes * 60_000;
  const overlap = subtract(intersect(merge(a), merge(b)), (opts.booked ?? []).map(toInterval));
  const slots: Slot[] = [];
  for (const o of overlap) {
    const start = Math.max(o.start, earliest);
    if (o.end - start >= length) {
      slots.push({ start: new Date(start).toISOString(), end: new Date(start + length).toISOString() });
    }
    if (slots.length >= (opts.max ?? 3)) break;
  }
  return slots;
}
