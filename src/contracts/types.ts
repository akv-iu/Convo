/**
 * Shared types for Convo. Every API route, fake and real, validates its
 * request and response against these schemas. Frozen after checkpoint C0:
 * change them only in a PR approved by both people, together with the fake
 * and the contract test.
 */
import { z } from "zod";

export const AskType = z.enum(["knowledge", "career", "collaboration", "hiring"]);
export type AskType = z.infer<typeof AskType>;

export const HardFilters = z.object({
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: z.string().length(2),
  /** ROR ID of the workplace, e.g. "https://ror.org/00f54p054", or null. */
  rorId: z.string().nullable(),
  hiring: z.boolean(),
});
export type HardFilters = z.infer<typeof HardFilters>;

export const TimeBlock = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
});
export type TimeBlock = z.infer<typeof TimeBlock>;

export const Slot = TimeBlock;
export type Slot = TimeBlock;

export const Person = z.object({
  id: z.string(),
  name: z.string(),
  githubLogin: z.string(),
  bio: z.string(),
  languages: z.array(z.string()),
  organisations: z.array(z.string()),
  filters: HardFilters,
  /** Shown as a label in the UI. Demo profiles are synthetic; real sign-ups are not. */
  synthetic: z.boolean(),
  freeTimes: z.array(TimeBlock),
});
export type Person = z.infer<typeof Person>;

export const EvidenceKind = z.enum(["repo", "commit_area", "paper", "talk", "abstract"]);

export const EvidenceDoc = z.object({
  id: z.string(),
  personId: z.string(),
  kind: EvidenceKind,
  title: z.string(),
  text: z.string(),
  url: z.string().url().optional(),
});
export type EvidenceDoc = z.infer<typeof EvidenceDoc>;

export const RefinedAsk = z.object({
  text: z.string(),
  type: AskType,
  minutes: z.number().int().positive(),
});
export type RefinedAsk = z.infer<typeof RefinedAsk>;

export const Ask = z.object({
  id: z.string(),
  userId: z.string(),
  rawText: z.string(),
  refined: RefinedAsk.nullable(),
  status: z.enum(["open", "resolved"]),
  /** Soft blocker: hide people rejected for this ask, both ways. */
  softBlocker: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Ask = z.infer<typeof Ask>;

export const MatchResult = z.object({
  person: Person,
  /** Exact evidence snippets behind the match, for the card. */
  highlights: z.array(z.string()),
  /** Hard-filter badges, e.g. "not hiring". */
  badges: z.array(z.string()),
  /** True when this person's own asks match the requester. */
  mutual: z.boolean(),
  /** One "why this person" line. */
  explanation: z.string(),
  score: z.number(),
  rank: z.number().int().nonnegative(),
});
export type MatchResult = z.infer<typeof MatchResult>;

export const RequestStatus = z.enum(["sent", "accepted", "declined", "answered", "scheduled"]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const Request = z.object({
  id: z.string(),
  askId: z.string(),
  fromUserId: z.string(),
  toPersonId: z.string(),
  /** The refined question, carried with the request. */
  question: z.string(),
  minutes: z.number().int().positive(),
  status: RequestStatus,
  reply: z.string().nullable(),
  slot: Slot.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Request = z.infer<typeof Request>;

export const RorMatch = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().length(2),
});
export type RorMatch = z.infer<typeof RorMatch>;
