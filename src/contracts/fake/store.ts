/**
 * In-memory state for the fake API. Lives for the life of the dev server,
 * so two browser windows (demo user A and B) can play both sides.
 */
import * as fixtures from "@/contracts/fixtures";
import type { Ask, Person, Request, TimeBlock } from "@/contracts/types";
import { freshEnrichment, type FakeEnrichmentState } from "./enrichment";

export interface FakeState {
  enrichment: FakeEnrichmentState;
  people: Map<string, Person>;
  asks: Map<string, Ask>;
  requests: Map<string, Request>;
  /** askId -> rejected person ids, in order */
  rejections: Map<string, { personId: string; rank: number }[]>;
  counter: number;
}

export function freshState(): FakeState {
  return {
    enrichment: freshEnrichment(),
    people: new Map(fixtures.people.map((p) => [p.id, structuredClone(p)])),
    asks: new Map(),
    requests: new Map(),
    rejections: new Map(),
    counter: 0,
  };
}

// Next can bundle each route separately; they must still share one demo session.
const runtime = globalThis as typeof globalThis & { convoFakeState?: FakeState };

export const store = {
  get(): FakeState {
    return runtime.convoFakeState ??= freshState();
  },
  reset(): void {
    runtime.convoFakeState = freshState();
  },
  nextId(prefix: string): string {
    const state = store.get();
    state.counter += 1;
    return `${prefix}_${state.counter}`;
  },
  person(id: string): Person {
    const state = store.get();
    const p = state.people.get(id);
    if (!p) throw new NotFound(`person ${id}`);
    return p;
  },
  ask(id: string, userId: string): Ask {
    const state = store.get();
    const a = state.asks.get(id);
    if (!a || a.userId !== userId) throw new NotFound(`ask ${id}`);
    return a;
  },
  request(id: string): Request {
    const state = store.get();
    const r = state.requests.get(id);
    if (!r) throw new NotFound(`request ${id}`);
    return r;
  },
  bookedFor(personId: string): TimeBlock[] {
    const state = store.get();
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
