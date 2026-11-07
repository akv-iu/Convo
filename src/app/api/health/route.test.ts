import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, ping, list, construct, neonClient, connection } = vi.hoisted(() => ({
  query: vi.fn(), ping: vi.fn(), list: vi.fn(), construct: vi.fn(), neonClient: vi.fn(), connection: vi.fn(),
}));
vi.mock("@neondatabase/serverless", () => ({ neon: neonClient }));
vi.mock("next/server", () => ({ connection }));
vi.mock("@/server/search/elastic", () => ({ client: () => ({ ping }) }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { construct(options); }
  models = { list };
} }));

let get: typeof import("./route").GET;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://private-password@database.invalid/convo");
  vi.stubEnv("OPENAI_API_KEY", "private-api-key");
  connection.mockResolvedValue(undefined);
  neonClient.mockReturnValue({ query });
  query.mockResolvedValue([{ ok: 1 }]);
  ping.mockResolvedValue(true);
  list.mockResolvedValue({ data: [] });
  get = (await import("./route")).GET;
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("operational health", () => {
  it("waits for a real request before starting provider probes", async () => {
    let release = () => {};
    connection.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const response = get();
    await Promise.resolve();
    expect(connection).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    release();
    expect((await response).status).toBe(200);
  });

  it("checks all three dependencies and returns uncached health", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "up", dependencies: { postgres: "up", elasticsearch: "up", openai: "up" } });
    expect(query).toHaveBeenCalledWith("select 1 as ok", [], { fetchOptions: { signal: expect.any(AbortSignal) } });
    expect(ping).toHaveBeenCalledWith({}, { requestTimeout: 5_000, maxRetries: 0 });
    expect(construct).toHaveBeenCalledWith({ apiKey: "private-api-key", timeout: 5_000, maxRetries: 0 });
    expect(list).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(["postgres", "elasticsearch", "openai"] as const)("reports %s down without exposing provider errors", async dependency => {
    const mock = { postgres: query, elasticsearch: ping, openai: list }[dependency];
    mock.mockRejectedValueOnce(new Error("private-password private-api-key upstream error body"));
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "down", dependencies: { postgres: "up", elasticsearch: "up", openai: "up", [dependency]: "down" },
    });
    expect(query).toHaveBeenCalledOnce();
    expect(ping).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledOnce();
  });

  it("reports missing configuration and synchronous client errors safely", async () => {
    vi.stubEnv("DATABASE_URL", "");
    construct.mockImplementationOnce(() => { throw new Error("private-api-key"); });
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "down", dependencies: { postgres: "down", elasticsearch: "up", openai: "down" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("reports an invalid database reply and a failed cluster ping", async () => {
    query.mockResolvedValueOnce([]);
    ping.mockResolvedValueOnce(false);
    expect(await (await get()).json()).toEqual({ status: "down", dependencies: { postgres: "down", elasticsearch: "down", openai: "up" } });
  });

  it("coalesces concurrent calls and refreshes an unhealthy result after thirty seconds", async () => {
    vi.useFakeTimers();
    list.mockRejectedValueOnce(new Error("timeout"));
    const responses = await Promise.all([get(), get(), get()]);
    expect(responses.map(response => response.status)).toEqual([503, 503, 503]);
    expect(list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await get()).status).toBe(200);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
