import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...await importOriginal<typeof import("@neondatabase/serverless")>(), neon: () => ({ query }),
}));
import { contactFromRow, getContact, saveContact } from "./contact";

const details = { email: "ana@example.com", phone: "+44 7700 900123", share: "phone" as const };
const row = [details.email, details.phone, details.share];

beforeEach(() => {
  query.mockReset();
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@example.invalid/unused");
});
afterEach(() => vi.unstubAllEnvs());

describe("contactFromRow", () => {
  it("reads the three columns, defaulting what to share to email", () => {
    expect(contactFromRow({ contactEmail: "ana@example.com", contactPhone: null, contactShare: null }))
      .toEqual({ email: "ana@example.com", phone: null, share: "email" });
  });

  it("falls back to nothing rather than passing on a malformed stored value", () => {
    expect(contactFromRow({ contactEmail: "not-an-email", contactPhone: null, contactShare: "email" }))
      .toEqual({ email: null, phone: null, share: "email" });
  });
});

describe("getContact", () => {
  it("returns the signed-in user's details", async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(getContact("u1")).resolves.toEqual(details);
  });

  it("is a 404 without a profile and a 503 when storage fails", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getContact("u1")).rejects.toMatchObject({ status: 404 });
    query.mockRejectedValueOnce(new Error("down"));
    await expect(getContact("u1")).rejects.toMatchObject({ status: 503 });
  });
});

describe("saveContact", () => {
  it("saves and returns what was stored", async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    await expect(saveContact("u1", details)).resolves.toEqual(details);
    expect(query.mock.calls[0][0]).toContain('update "users"');
  });

  it("is a 404 without a profile and a 503 when storage fails", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(saveContact("u1", details)).rejects.toMatchObject({ status: 404 });
    query.mockRejectedValueOnce(new Error("down"));
    await expect(saveContact("u1", details)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("Nothing was saved") });
  });
});
