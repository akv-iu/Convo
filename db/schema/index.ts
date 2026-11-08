/**
 * Postgres schema (B2). Source records are durable here; Elasticsearch is
 * the searchable copy. Run `npm run db:generate` after changing this.
 */
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AvatarId, BadgeColour, EvidenceDoc, HardFilters, ProfileVisibility, RefinedAsk, TimeBlock } from "@/contracts/types";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Auth.js user id
  githubLogin: text("github_login"),
  name: text("name").notNull(),
  bio: text("bio").notNull().default(""),
  languages: jsonb("languages").$type<string[]>().notNull().default([]),
  organisations: jsonb("organisations").$type<string[]>().notNull().default([]),
  filters: jsonb("filters").$type<HardFilters>(),
  freeTimes: jsonb("free_times").$type<TimeBlock[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revision: integer("revision").notNull().default(0),
  workplaceName: text("workplace_name"),
  badgeColour: text("badge_colour").$type<BadgeColour>().notNull().default("sunflower"),
  visibility: jsonb("visibility").$type<ProfileVisibility>().notNull().default({ country: true, workplace: true, hiring: true }),
  githubEvidence: jsonb("github_evidence").$type<EvidenceDoc[]>().notNull().default([]),
  githubEvidencePending: boolean("github_evidence_pending").notNull().default(false),
  /** A built-in picture (Person.avatar); null shows initials. Last, so existing row reads keep their column order. */
  avatar: text("avatar").$type<AvatarId>(),
});

/** Provider subjects (GitHub numeric ID / Google sub) belong to one stable Lanyard account. */
export const authIdentities = pgTable("auth_identities", {
  provider: text("provider", { enum: ["github", "google"] }).notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
}, table => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
  uniqueIndex("auth_identities_user_provider_idx").on(table.userId, table.provider),
]);

/** Short-lived linking attempts contain no provider credential or imported profile text. */
export const authLinkAttempts = pgTable("auth_link_attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  sessionHash: text("session_hash").notNull(),
  stateHash: text("state_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, table => [uniqueIndex("auth_link_attempts_state_idx").on(table.stateHash)]);

export const asks = pgTable(
  "asks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    rawText: text("raw_text").notNull(),
    refined: jsonb("refined").$type<RefinedAsk>(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    softBlocker: boolean("soft_blocker").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asks_user_idx").on(t.userId)],
);

export const rejections = pgTable(
  "rejections",
  {
    id: text("id").primaryKey(),
    askId: text("ask_id").notNull().references(() => asks.id),
    personId: text("person_id").notNull(),
    rank: integer("rank").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One rejection per person per ask, so a retry or double tap never counts toward batch reject twice.
  (t) => [uniqueIndex("rejections_ask_person_idx").on(t.askId, t.personId)],
);

export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey(),
    askId: text("ask_id").notNull().references(() => asks.id),
    fromUserId: text("from_user_id").notNull().references(() => users.id),
    toPersonId: text("to_person_id").notNull(),
    question: text("question").notNull(),
    minutes: integer("minutes").notNull(),
    status: text("status", { enum: ["sent", "accepted", "declined", "answered", "scheduled"] }).notNull().default("sent"),
    reply: text("reply"),
    slot: jsonb("slot").$type<TimeBlock>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("requests_to_idx").on(t.toPersonId),
    index("requests_from_idx").on(t.fromUserId),
    // One request per person per ask: a resend returns the saved request instead of a duplicate.
    uniqueIndex("requests_ask_person_idx").on(t.askId, t.toPersonId),
  ],
);

/** AI replies cached by a hash of their input, so repeats cost nothing. */
export const aiCache = pgTable(
  "ai_cache",
  {
    key: text("key").primaryKey(),
    kind: text("kind", { enum: ["refine", "explain", "moderate"] }).notNull(),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_cache_key_idx").on(t.key)],
);
