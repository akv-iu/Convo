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
  /** Keep the complete enrichment flow off until all implementation PRs land. */
  profileEnrichmentEnabled: process.env.PROFILE_ENRICHMENT_ENABLED === "1",
  /** Private discovery credentials; each source can be unavailable independently. */
  openAlexApiKey: process.env.OPENALEX_API_KEY ?? "",
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY ?? "",
  /** Authenticates Vercel's scheduled private-input cleanup (Authorization: Bearer <secret>). Unset or under 16 characters: the endpoint refuses every request. */
  cronSecret: (process.env.CRON_SECRET?.length ?? 0) >= 16 ? process.env.CRON_SECRET! : null,
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
