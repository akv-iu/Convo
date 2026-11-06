/**
 * Postgres schema (B2). Source records are durable here; Elasticsearch is
 * the searchable copy. Run `npm run db:generate` after changing this.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { BadgeColour, EvidenceDoc, HardFilters, ProfileVisibility, RefinedAsk, TimeBlock } from "@/contracts/types";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Auth.js user id
  githubLogin: text("github_login").notNull(),
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
});

export const asks = pgTable(
  "asks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    rawText: text("raw_text").notNull(),
    refined: jsonb("refined").$type<RefinedAsk>(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    softBlocker: boolean("soft_blocker").notNull().default(true),
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
  (t) => [index("rejections_ask_idx").on(t.askId)],
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
  (t) => [index("requests_to_idx").on(t.toPersonId), index("requests_from_idx").on(t.fromUserId)],
);

/** AI replies cached by a hash of their input, so repeats cost nothing. */
export const aiCache = pgTable(
  "ai_cache",
  {
    key: text("key").primaryKey(),
    kind: text("kind", { enum: ["refine", "explain"] }).notNull(),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_cache_key_idx").on(t.key)],
);
