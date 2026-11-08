import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER_A, DEMO_USER_B, people } from "@/contracts/fixtures";
import { routes } from "@/contracts/routes";
import { store } from "@/contracts/fake/store";

/** POST /api/asks (save as written) and POST /api/refine/preview, in fake and real mode, without live services. */
const { query, runtime, identity } = vi.hoisted(() => ({
  query: vi.fn(), identity: { userId: "u_demo_a" as string | null },
  runtime: { fakeApi: false, fakeSearch: true, fakeAi: true, batchRejectAfter: 3, slotLockoutMinutes: 60, maxSlots: 3 },
}));
vi.mock("@/server/config", () => ({ config: runtime }));
vi.mock("@/server/auth", () => ({ getUserId: async () => identity.userId }));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), connection: async () => undefined,
}));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { POST as saveAsk } from "./route";
import { POST as preview } from "../refine/preview/route";

const person = people[0];
const context = () => ({ params: Promise.resolve({}) });
const request = (path: string, body: unknown) => new Request(`http://localhost:3000/api/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
function profileRows() {
  return { rows: [[person.id, person.githubLogin, person.name, person.bio,
    JSON.stringify(person.languages), JSON.stringify(person.organisations), JSON.stringify(person.filters),
    JSON.stringify(person.freeTimes), "2026-11-05T12:00:00Z", 1, null, "sunflower", JSON.stringify(person.visibility), "[]", false]] };
}
const inserts = () => query.mock.calls.filter(([sql]) => String(sql).startsWith("insert"));

beforeEach(() => {
  runtime.fakeApi = false;
  identity.userId = DEMO_USER_A;
  store.reset();
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected live request")));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  if (runtime.fakeApi) expect(query).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe.each(["fake", "real"] as const)("%s ask-as-written HTTP contract", (mode) => {
  beforeEach(() => { runtime.fakeApi = mode === "fake"; });

  it("saves the question exactly as written for the signed-in user, ignoring forged fields", async () => {
    if (mode === "real") query.mockResolvedValueOnce(profileRows());
    const before = store.get().asks.size;
    const response = await saveAsk(request("asks", {
      text: "  how does Raft do the voting thing  ", type: "collaboration", userId: DEMO_USER_B, id: "forged-id",
    }), context());
    expect(response.status).toBe(200);
    const saved = routes.saveAsk.response.parse(await response.json());
    expect(saved.askId).not.toBe("forged-id");
    expect(saved.ask).toMatchObject({
      id: saved.askId, userId: DEMO_USER_A, rawText: "how does Raft do the voting thing", status: "open", softBlocker: false,
      refined: { text: "how does Raft do the voting thing", type: "collaboration", minutes: 5 },
    });
    if (mode === "real") {
      expect(inserts()).toHaveLength(1);
      expect(store.get().asks.size).toBe(before); // the real route writes to Postgres, not the demo store
    } else {
      expect(store.get().asks.get(saved.askId)).toEqual(saved.ask);
    }
  });

  it("previews a sharper question and saves nothing", async () => {
    if (mode === "real") query.mockResolvedValueOnce(profileRows());
    const before = store.get().asks.size;
    const response = await preview(request("refine/preview", { text: "how does Raft do the voting thing" }), context());
    expect(response.status).toBe(200);
    const { refined } = routes.previewRefine.response.parse(await response.json());
    expect(refined.text).toContain("how does Raft do the voting thing");
    expect(inserts()).toHaveLength(0);
    expect(store.get().asks.size).toBe(before);
  });

  it("refuses a flagged ask on both routes with 422, and saves nothing", async () => {
    if (mode === "real") query.mockResolvedValue(profileRows());
    for (const [handler, path] of [[saveAsk, "asks"], [preview, "refine/preview"]] as const) {
      const response = await handler(request(path, { text: "you absolute idiot" }), context());
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: expect.stringContaining("can't be sent") });
    }
    expect(inserts()).toHaveLength(0);
    query.mockReset(); // nothing more is read after the profile
  });

  it("rejects bad bodies at the contract (400) and requires sign-in (401)", async () => {
    for (const body of [{ text: "hi" }, { text: "x".repeat(501) }, { text: "Hello there", minutes: 45 }, { text: "Hello there", type: "gossip" }]) {
      expect((await saveAsk(request("asks", body), context())).status).toBe(400);
    }
    expect((await preview(request("refine/preview", { text: "  " }), context())).status).toBe(400);
    identity.userId = null;
    expect((await saveAsk(request("asks", { text: "scheduler preemption" }), context())).status).toBe(401);
    expect((await preview(request("refine/preview", { text: "scheduler preemption" }), context())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("real ask-as-written failures", () => {
  it("returns a sanitized 503 when the save can't be confirmed", async () => {
    query.mockResolvedValueOnce(profileRows()).mockRejectedValueOnce(new Error("private-database-url"));
    const response = await saveAsk(request("asks", { text: "scheduler preemption" }), context());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private-database-url");
  });

  it("a missing profile is 404 (the screen sends them to sign in) and nothing is saved", async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no profile row
    const response = await saveAsk(request("asks", { text: "scheduler preemption" }), context());
    expect(response.status).toBe(404);
    expect(inserts()).toHaveLength(0);
  });
});
