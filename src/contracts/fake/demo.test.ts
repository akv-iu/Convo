import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER_A, DEMO_USER_B } from "@/contracts/fixtures";
import { playDemo } from "./demo";
import { store } from "./store";

const incoming = () => [...store.get().requests.values()].filter((r) => r.toPersonId === DEMO_USER_A);
const synthetic = () => [...store.get().people.values()].filter((p) => p.synthetic);

function sendTo(toPersonId: string, ageMs: number) {
  const id = store.nextId("req");
  store.get().requests.set(id, {
    id, askId: `ask-${id}`, fromUserId: DEMO_USER_A, toPersonId, question: "q", message: null, minutes: 5,
    status: "sent", reply: null, slot: null, createdAt: new Date(Date.now() - ageMs).toISOString(),
  });
  return store.request(id);
}

beforeEach(() => store.reset());

describe("demo activity (FAKE_DEMO)", () => {
  it("sends you two requests from demo attendees, once", () => {
    playDemo(DEMO_USER_A);
    const first = incoming();
    expect(first).toHaveLength(2);
    expect(first.every((r) => store.get().people.get(r.fromUserId)?.synthetic)).toBe(true);
    expect(first.some((r) => r.message)).toBe(true);
    for (const r of first) expect(store.get().asks.get(r.askId)?.userId).toBe(r.fromUserId);
    playDemo(DEMO_USER_A);
    expect(incoming()).toHaveLength(2);
  });

  it("does nothing for someone without a profile", () => {
    playDemo("nobody");
    expect(store.get().requests.size).toBe(0);
  });

  it("has demo attendees reply to your requests after a short wait, and only theirs", () => {
    const [a, b, c] = synthetic();
    const old = [a, b, c].map((p) => sendTo(p.id, 60_000));
    const fresh = sendTo(a.id, 1_000);
    const toPerson = sendTo(DEMO_USER_B, 60_000);
    playDemo(DEMO_USER_A);
    for (const r of old) {
      expect(["accepted", "answered", "declined"]).toContain(r.status);
      if (r.status === "answered") expect(r.reply).toBeTruthy();
    }
    expect(fresh.status).toBe("sent");
    expect(toPerson.status).toBe("sent");
  });

  it("has most demo attendees accept", () => {
    for (const p of synthetic()) sendTo(p.id, 60_000);
    playDemo(DEMO_USER_A);
    const mine = [...store.get().requests.values()].filter((r) => r.fromUserId === DEMO_USER_A);
    expect(mine.filter((r) => r.status === "accepted").length).toBeGreaterThan(0);
  });
});
