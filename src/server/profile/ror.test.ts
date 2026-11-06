import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/contracts/routes";
import fixture from "./fixtures/ror.json";
import { searchWorkplaces } from "./ror";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(Response.json(fixture));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("ROR workplace search", () => {
  it("maps v2 display names and the first location into the shared contract", async () => {
    const matches = await searchWorkplaces("  Stanford  ");
    expect(matches).toEqual([
      { id: "https://ror.org/00f54p054", name: "Stanford University", country: "US" },
      { id: "https://ror.org/052gg0110", name: "University of Oxford", country: "GB" },
    ]);
    expect(routes.searchRor.response.parse(matches)).toEqual(matches);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.ror.org/v2/organizations?query=Stanford");
    expect(options).toMatchObject({ headers: { Accept: "application/json" }, cache: "no-store", redirect: "error" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["", " \t\n "])("does not call ROR for an empty query", async (query) => {
    expect(await searchWorkplaces(query)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized query before making an external request", async () => {
    await expect(searchWorkplaces("x".repeat(201))).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes Unicode and ampersands, escaping ROR's reserved query characters", async () => {
    await searchWorkplaces("École & Lab (R&D)/A+B?*");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.ror.org/v2/organizations");
    expect([...url.searchParams.keys()]).toEqual(["query"]);
    expect(url.searchParams.get("query")).toBe("École & Lab \\(R&D\\)\\/A\\+B\\?\\*");
  });

  it("returns no matches when ROR finds nothing", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    expect(await searchWorkplaces("no-such-workplace")).toEqual([]);
  });

  it("caps results at eight while retaining upstream relevance order", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      ...fixture.items[0], id: `https://ror.org/00abcde${String(i).padStart(2, "0")}`,
    }));
    fetchMock.mockResolvedValueOnce(Response.json({ items }));
    expect((await searchWorkplaces("University")).map(({ id }) => id)).toEqual(items.slice(0, 8).map(({ id }) => id));
  });

  it.each([400, 429, 500])("reports an upstream %i safely as an unavailable lookup", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("private upstream details", { status }));
    const error = await searchWorkplaces("Stanford").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private upstream details");
  });

  it.each([
    new Error("private network details"),
    new DOMException("private network details", "TimeoutError"),
  ])("handles network/timeout failures without forwarding their details", async (failure) => {
    fetchMock.mockRejectedValueOnce(failure);
    const error = await searchWorkplaces("Stanford").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private network details");
  });

  it.each([
    null,
    { errors: ["bad upstream query"] },
    { items: [{ ...fixture.items[0], names: [{ value: "Alias", types: ["alias"] }] }] },
    { items: [{ ...fixture.items[0], id: "https://untrusted.test/00f54p054" }] },
    { items: [{ ...fixture.items[0], locations: [] }] },
    { items: [{ ...fixture.items[0], locations: [{ geonames_details: { country_code: "USA" } }] }] },
  ])("rejects malformed upstream data without returning an off-contract match", async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await expect(searchWorkplaces("Stanford")).rejects.toMatchObject({ status: 503 });
  });

  it("sanitizes a malformed JSON response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private invalid JSON", { status: 200 }));
    const error = await searchWorkplaces("Stanford").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(String(error)).not.toContain("private invalid JSON");
  });
});
