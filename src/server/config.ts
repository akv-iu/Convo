/**
 * The one place that reads the switches.
 *
 * FAKE_API=1          every API route answers from the in-memory fake (A's default)
 * FAKES=search,ai     the real routes use in-memory search and/or canned AI replies (B, while building)
 */
const fakes = new Set(
  (process.env.FAKES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const config = {
  fakeApi: process.env.FAKE_API === "1",
  fakeSearch: fakes.has("search"),
  fakeAi: fakes.has("ai"),
  /**
   * FAKE_DEMO=1 (with FAKE_API=1): the fake inbox gets a few requests from demo attendees, and
   * people you send requests to reply after a short wait. Off in tests and CI.
   */
  fakeDemo: process.env.FAKE_API === "1" && process.env.FAKE_DEMO === "1",
  /** Rejections for one ask before lower-ranked results are hidden too. */
  batchRejectAfter: 3,
  /** A suggested slot is never closer than this. */
  slotLockoutMinutes: 60,
  maxSlots: 3,
} as const;
