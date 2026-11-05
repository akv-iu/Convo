/**
 * In-memory state for the fake API. Lives for the life of the dev server,
 * so two browser windows (demo user A and B) can play both sides.
 */
import * as fixtures from "@/contracts/fixtures";
import type { Ask, Person, Request, TimeBlock } from "@/contracts/types";

export interface FakeState {
  people: Map<string, Person>;
  asks: Map<string, Ask>;
  requests: Map<string, Request>;
  /** askId -> rejected person ids, in order */
  rejections: Map<string, { personId: string; rank: number }[]>;
  counter: number;
}

export function freshState(): FakeState {
  return {
    people: new Map(fixtures.people.map((p) => [p.id, structuredClone(p)])),
    asks: new Map(),
    requests: new Map(),
    rejections: new Map(),
    counter: 0,
  };
}

let state = freshState();

export const store = {
  get(): FakeState {
    return state;
  },
  reset(): void {
    state = freshState();
  },
  nextId(prefix: string): string {
    state.counter += 1;
    return `${prefix}_${state.counter}`;
  },
  person(id: string): Person {
    const p = state.people.get(id);
    if (!p) throw new NotFound(`person ${id}`);
    return p;
  },
  ask(id: string, userId: string): Ask {
    const a = state.asks.get(id);
    if (!a || a.userId !== userId) throw new NotFound(`ask ${id}`);
    return a;
  },
  request(id: string): Request {
    const r = state.requests.get(id);
    if (!r) throw new NotFound(`request ${id}`);
    return r;
  },
  bookedFor(personId: string): TimeBlock[] {
    return [...state.requests.values()]
      .filter((r) => r.slot && (r.fromUserId === personId || r.toPersonId === personId))
      .map((r) => r.slot!);
  },
};

export class NotFound extends Error {
  status = 404;
}

export class Forbidden extends Error {
  status = 403;
}
