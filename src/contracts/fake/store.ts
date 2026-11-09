/**
 * In-memory state for the fake API. Lives for the life of the dev server,
 * so two browser windows (demo user A and B) can play both sides.
 */
import * as fixtures from "@/contracts/fixtures";
import type { Ask, ContactDetails, Person, Request, TimeBlock } from "@/contracts/types";
import { freshEnrichment, type FakeEnrichmentState } from "./enrichment";

export interface FakeState {
  pendingPeople: Map<string, Omit<Person, "filters"> & { filters: null }>;
  enrichment: FakeEnrichmentState;
  people: Map<string, Person>;
  asks: Map<string, Ask>;
  requests: Map<string, Request>;
  /** askId -> rejected person ids, in order */
  rejections: Map<string, { personId: string; rank: number }[]>;
  /** Private contact details by person; demo attendees come with made-up ones. */
  contacts: Map<string, ContactDetails>;
  /** People whose demo inbox has been filled (FAKE_DEMO). */
  seeded: Set<string>;
  counter: number;
}

/** Made-up contact details for the demo attendees (example.com and the UK's drama number range). */
function demoContact(person: Person, i: number): ContactDetails {
  const login = person.githubLogin ?? person.id;
  const share = (["email", "both", "phone"] as const)[i % 3];
  return { email: `${login}@example.com`, phone: `+44 7700 900${String(100 + i).slice(-3)}`, share };
}

function newGooglePerson(id: string): Omit<Person, "filters"> & { filters: null } {
  return { id, name: "New demo attendee", githubLogin: null, bio: "", languages: [], organisations: [], filters: null, synthetic: false, freeTimes: [] };
}

export function freshState(): FakeState {
  return {
    pendingPeople: new Map([[fixtures.DEMO_GOOGLE_NEW, newGooglePerson(fixtures.DEMO_GOOGLE_NEW)]]),
    enrichment: freshEnrichment(),
    people: new Map(fixtures.people.map((p) => [p.id, structuredClone(p)])),
    asks: new Map(),
    requests: new Map(),
    rejections: new Map(),
    contacts: new Map(fixtures.people.filter((p) => p.synthetic).map((p, i) => [p.id, demoContact(p, i)])),
    seeded: new Set(),
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
    if (!state.people.has(id) && fixtures.isNewGoogleDemoUser(id)) store.profile(id);
    const p = state.people.get(id);
    if (!p && state.pendingPeople.has(id)) throw Object.assign(new Error("Complete onboarding first."), { status: 409 });
    if (!p) throw new NotFound(`person ${id}`);
    return p;
  },
  profile(id: string) {
    const state = store.get();
    if (!state.people.has(id) && !state.pendingPeople.has(id) && fixtures.isNewGoogleDemoUser(id)) state.pendingPeople.set(id, newGooglePerson(id));
    const profile = state.people.get(id) ?? state.pendingPeople.get(id);
    if (!profile) throw new NotFound(`person ${id}`);
    return profile;
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
