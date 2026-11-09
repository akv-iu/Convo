/**
 * Shared types for Convo. Every API route, fake and real, validates its
 * request and response against these schemas. Frozen after checkpoint C0:
 * change them only in a PR approved by both people, together with the fake
 * and the contract test.
 */
import { z } from "zod";

export const SourceUrl = z.url({ protocol: /^https$/ }).max(2048).refine(value => {
  try { const url = new URL(value); return !url.username && !url.password; } catch { return false; }
}, "Use an HTTPS URL without credentials");

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

export const BadgeColour = z.enum(["sunflower", "mint", "sky", "lilac", "coral"]);
export type BadgeColour = z.infer<typeof BadgeColour>;

/**
 * The built-in pictures a person can choose for their badge: twelve shapes and ten illustrated
 * faces (the homepage's attendees). Original art in src/components/ui/avatars.tsx and hero-faces.tsx.
 */
export const AvatarId = z.enum([
  "star", "moon", "sun", "leaf", "wave", "peak", "bolt", "heart", "flower", "cloud", "gem", "spark",
  "face-amara", "face-hiroshi", "face-fatima", "face-gurpreet", "face-sofia", "face-liam", "face-kwame", "face-leilani", "face-mei", "face-zawadi",
]);
export type AvatarId = z.infer<typeof AvatarId>;

export const ProfileVisibility = z.object({
  country: z.boolean(),
  workplace: z.boolean(),
  hiring: z.boolean(),
});
export type ProfileVisibility = z.infer<typeof ProfileVisibility>;

export const Person = z.object({
  id: z.string(),
  name: z.string(),
  githubLogin: z.string().nullable(),
  bio: z.string(),
  languages: z.array(z.string()),
  /** Professional/research topics; absent on older profiles. */
  expertise: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
  organisations: z.array(z.string()),
  filters: HardFilters,
  /** Display name for either a listed or unlisted workplace; null clears it. */
  workplaceName: z.string().trim().min(1).max(200).nullable().optional(),
  /** Optional for older profiles/clients; display sunflower when absent. */
  badgeColour: BadgeColour.optional(),
  /**
   * A built-in picture, always shown (not a show/hide section). Null or absent means initials on
   * the badge colour; synthetic profiles have none. Photo uploads are a later, separate field.
   */
  avatar: AvatarId.nullable().optional(),
  /** Card display only; hidden values remain available for matching. */
  visibility: ProfileVisibility.optional(),
  /** Shown as a label in the UI. Demo profiles are synthetic; real sign-ups are not. */
  synthetic: z.boolean(),
  freeTimes: z.array(TimeBlock),
});
export type Person = z.infer<typeof Person>;

/** A person as other people see them: sections they hid are null. */
export const CardPerson = Person.extend({
  filters: HardFilters.extend({ country: z.string().length(2).nullable(), hiring: z.boolean().nullable() }),
});
export type CardPerson = z.infer<typeof CardPerson>;

export const EvidenceKind = z.enum(["repo", "commit_area", "paper", "talk", "abstract", "profile_page", "cv"]);

export const EvidenceDoc = z.object({
  id: z.string(),
  personId: z.string(),
  kind: EvidenceKind,
  title: z.string(),
  text: z.string(),
  url: SourceUrl.optional(),
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

/**
 * One piece of evidence behind a match, for the open profile: what it is, its title, and a
 * link when it has a public https one (other schemes are dropped before they get here).
 */
export const MatchEvidence = z.object({
  kind: EvidenceKind,
  title: z.string(),
  url: z.string().url().startsWith("https://").optional(),
});
export type MatchEvidence = z.infer<typeof MatchEvidence>;

export const MatchResult = z.object({
  person: CardPerson,
  /**
   * Exact evidence snippets behind the match, for the card. Matched words are wrapped in
   * <em>…</em>; render everything as text and treat only those two tags as marks.
   */
  highlights: z.array(z.string()),
  /** The evidence behind the match, best match first (the search's order), at most 5. */
  evidence: z.array(MatchEvidence).max(5),
  /** Hard-filter badges, e.g. "not hiring". */
  badges: z.array(z.string()),
  /** True when this person's own asks match the requester. */
  mutual: z.boolean(),
  /** One "why this person" line. */
  explanation: z.string(),
  score: z.number(),
  /**
   * Place in this ask's ranking. People already rejected or sent a request keep their place but
   * aren't returned, so ranks stay the same across refreshes and can have gaps.
   */
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

/** A request as it appears in the inbox or sent list: with the other person's badge and the ask's type. */
export const RequestView = Request.extend({
  /** What kind of conversation it is; null for an ask that was never refined. */
  type: AskType.nullable(),
  /**
   * The other person's badge, with their show/hide choices applied: the asker in the inbox,
   * the receiver in sent requests. Null if that profile can't be found any more.
   */
  person: CardPerson.nullable(),
});
export type RequestView = z.infer<typeof RequestView>;

export const RorMatch = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().length(2),
});
export type RorMatch = z.infer<typeof RorMatch>;
