/**
 * The API contract: every route the screens may call, with its request and
 * response schemas. The fake API and the real API both implement this list,
 * and /dev/routes renders it. Frozen after checkpoint C0.
 */
import { z } from "zod";
import {
  AcceptEnrichment, AcceptedEnrichment, CvUpload, DiscoverEnrichment, EnrichmentDiscovery,
  EnrichmentJob, EnrichmentSync, SavedEnrichmentSource, StartEnrichment, UploadCv, EnrichmentState, ConnectGitHub, EnrichmentIdentity,
} from "./enrichment";
import {
  Ask,
  AskType,
  MatchResult,
  Person,
  RefinedAsk,
  Request,
  RequestView,
  RorMatch,
  Slot,
  TimeBlock,
} from "./types";

export type Method = "GET" | "POST" | "PUT";

export interface RouteDef {
  method: Method;
  path: string;
  description: string;
  /** Who builds the screen that calls it. */
  usedBy: "A1" | "A2";
  body?: z.ZodTypeAny;
  contentType?: "multipart/form-data";
  response: z.ZodTypeAny;
}

/** Keeps each route's exact shape, so a route without a body has no `body` type at all. */
function def<const D extends RouteDef>(d: D): D {
  return d;
}

/** Bounds on an ask's text as the asker writes it (the ask box uses the same maximum). */
export const ASK_TEXT_MIN = 3;
export const ASK_TEXT_MAX = 500;
/** An ask's text as written: trimmed, then 3 to 500 characters. */
const AskText = z.string().trim().min(ASK_TEXT_MIN).max(ASK_TEXT_MAX);

export const routes = {
  enrichmentState: def({
    method: "GET", path: "/api/profile-enrichment", usedBy: "A1",
    description: "Resume the owner's identity, connection, job and pending CV before onboarding is complete.", response: EnrichmentState,
  }),
  saveEnrichmentIdentity: def({
    method: "PUT", path: "/api/profile-enrichment", usedBy: "A1",
    description: "Save private page-one answers after authentication so another tab can resume before final Continue.",
    body: EnrichmentIdentity, response: EnrichmentState,
  }),
  connectGitHub: def({
    method: "POST", path: "/api/profile-enrichment/github/connect", usedBy: "A1",
    description: "Connect GitHub to the current Lanyard account, without switching or merging accounts.", response: ConnectGitHub,
  }),
  discoverEnrichment: def({
    method: "POST", path: "/api/profile-enrichment/discover", usedBy: "A1",
    description: "Discover one selected source independently; return up to four candidates, never selected automatically.",
    body: DiscoverEnrichment, response: EnrichmentDiscovery,
  }),
  uploadCv: def({
    method: "POST", path: "/api/profile-enrichment/cv", usedBy: "A1", contentType: "multipart/form-data",
    description: "Stage one consented PDF/DOCX or pasted CV text; no raw contents in the response.",
    body: UploadCv, response: CvUpload,
  }),
  removeCv: def({
    method: "POST", path: "/api/profile-enrichment/cv/:id/remove", usedBy: "A1",
    description: "Discard an unaccepted upload, including when its source is switched off.",
    response: z.object({ removed: z.literal(true) }),
  }),
  startEnrichment: def({
    method: "POST", path: "/api/profile-enrichment", usedBy: "A1",
    description: "Confirm source choices and start one idempotent import/synthesis job, before onboarding is complete.",
    body: StartEnrichment, response: EnrichmentJob,
  }),
  getEnrichment: def({
    method: "GET", path: "/api/profile-enrichment/:id", usedBy: "A1",
    description: "Owner-only progress, sanitized source failures and reviewable draft/evidence.", response: EnrichmentJob,
  }),
  retryEnrichment: def({
    method: "POST", path: "/api/profile-enrichment/:id/retry", usedBy: "A1",
    description: "Retry failed or interrupted work; a running job cannot be claimed twice.", response: EnrichmentJob,
  }),
  acceptEnrichment: def({
    method: "POST", path: "/api/profile-enrichment/:id/accept", usedBy: "A1",
    description: "Approve edited bio/expertise and evidence; stale drafts conflict, saved but unindexed results are explicit.",
    body: AcceptEnrichment, response: AcceptedEnrichment,
  }),
  cancelEnrichment: def({
    method: "POST", path: "/api/profile-enrichment/:id/cancel", usedBy: "A1",
    description: "Cancel an unaccepted job and discard private temporary inputs.", response: EnrichmentJob,
  }),
  enrichmentSources: def({
    method: "GET", path: "/api/profile-enrichment/sources", usedBy: "A1",
    description: "List the owner's approved sources so returning users can remove them.", response: z.array(SavedEnrichmentSource).max(4),
  }),
  removeEnrichmentSource: def({
    method: "POST", path: "/api/profile-enrichment/sources/:id/remove", usedBy: "A1",
    description: "Withdraw one source, invalidate old work and report search synchronization.",
    response: z.object({ removed: z.literal(true), reviewBio: z.boolean(), sync: EnrichmentSync }),
  }),
  getMe: def({
    method: "GET",
    path: "/api/me",
    description: "The signed-in user's profile, built from GitHub plus the onboarding answers.",
    usedBy: "A1",
    response: Person,
  }),
  putMe: def({
    method: "PUT",
    path: "/api/me",
    description: "Save edits to the profile card and the onboarding answers.",
    usedBy: "A1",
    body: Person.partial().omit({ id: true, synthetic: true, githubLogin: true, expertise: true }),
    response: Person,
  }),
  searchRor: def({
    method: "GET",
    path: "/api/ror?q=",
    description: "Search-as-you-type for a workplace; returns ROR IDs.",
    usedBy: "A1",
    response: z.array(RorMatch),
  }),
  getAvailability: def({
    method: "GET",
    path: "/api/availability",
    description: "The user's free times during the conference.",
    usedBy: "A1",
    response: z.array(TimeBlock),
  }),
  putAvailability: def({
    method: "PUT",
    path: "/api/availability",
    description: "Replace the user's free times.",
    usedBy: "A1",
    body: z.array(TimeBlock),
    response: z.array(TimeBlock),
  }),
  refine: def({
    method: "POST",
    path: "/api/refine",
    description: "Turn a raw ask into a specific question, its type and a meeting length. Creates the ask.",
    usedBy: "A1",
    body: z.object({ text: z.string().min(3) }),
    response: z.object({ askId: z.string(), refined: RefinedAsk }),
  }),
  previewRefine: def({
    method: "POST",
    path: "/api/refine/preview",
    description:
      "Suggest a sharper question, its type and a meeting length. Saves nothing and registers nothing. " +
      "422 if moderation flags the text; 503 if the AI is unavailable.",
    usedBy: "A1",
    body: z.object({ text: AskText }),
    response: z.object({ refined: RefinedAsk }),
  }),
  saveAsk: def({
    method: "POST",
    path: "/api/asks",
    description:
      "Save the question exactly as given, with no rewrite: the asker's words, or a suggestion they kept or edited. " +
      "Type defaults to knowledge and minutes to 5. Moderation still runs: 422 if flagged, 503 if the check is unavailable.",
    usedBy: "A1",
    body: z.object({ text: AskText, type: AskType.optional(), minutes: z.number().int().min(5).max(30).optional() }),
    response: z.object({ askId: z.string(), ask: Ask }),
  }),
  match: def({
    method: "POST",
    path: "/api/match",
    description: "Evidence-backed, ranked people for an ask. Honours rejections and the soft blocker.",
    usedBy: "A2",
    body: z.object({ askId: z.string(), query: z.string().optional() }),
    response: z.array(MatchResult),
  }),
  reject: def({
    method: "POST",
    path: "/api/rejections",
    description:
      "Swipe left. After 3 rejected people for an ask, everyone ranked below the last rejection is hidden too. Rejecting the same person again isn't counted twice.",
    usedBy: "A2",
    body: z.object({ askId: z.string(), personId: z.string(), rank: z.number().int().nonnegative() }),
    response: z.object({ rejections: z.number().int(), hiddenBelowRank: z.number().int().nullable() }),
  }),
  setSoftBlocker: def({
    method: "PUT",
    path: "/api/soft-blocker",
    description: "Switch the soft blocker on or off for an ask.",
    usedBy: "A2",
    body: z.object({ askId: z.string(), enabled: z.boolean() }),
    response: z.object({ askId: z.string(), enabled: z.boolean() }),
  }),
  sendRequest: def({
    method: "POST",
    path: "/api/requests",
    description: "Swipe right: send the refined question to a person. One request per person per ask; sending again returns it.",
    usedBy: "A2",
    body: z.object({ askId: z.string(), toPersonId: z.string() }),
    response: Request,
  }),
  inbox: def({
    method: "GET",
    path: "/api/inbox",
    description: "Requests sent to the signed-in user, newest first, question up front, each with the asker's badge and the ask's type.",
    usedBy: "A2",
    response: z.array(RequestView),
  }),
  sentRequests: def({
    method: "GET",
    path: "/api/requests/sent",
    description: "Requests the signed-in user sent, newest first: each receiver's badge, status, reply and booked time.",
    usedBy: "A2",
    response: z.array(RequestView),
  }),
  respond: def({
    method: "POST",
    path: "/api/requests/:id/respond",
    description: "Receiver accepts, declines, or answers in a short reply without a meeting.",
    usedBy: "A2",
    body: z.discriminatedUnion("action", [
      z.object({ action: z.literal("accept") }),
      z.object({ action: z.literal("decline") }),
      z.object({ action: z.literal("reply"), reply: z.string().min(1) }),
    ]),
    response: Request,
  }),
  slots: def({
    method: "GET",
    path: "/api/requests/:id/slots",
    description: "Up to 3 slots where both people's free times overlap, none less than 1 hour away.",
    usedBy: "A2",
    response: z.array(Slot),
  }),
  schedule: def({
    method: "POST",
    path: "/api/requests/:id/schedule",
    description: "Book one of the suggested slots.",
    usedBy: "A2",
    body: z.object({ slot: Slot }),
    response: Request,
  }),
  getAsk: def({
    method: "GET",
    path: "/api/asks/:id",
    description: "One of the signed-in user's asks: the saved question, its status and soft-blocker setting.",
    usedBy: "A2",
    response: Ask,
  }),
  resolve: def({
    method: "POST",
    path: "/api/asks/:id/resolve",
    description: "Mark the ask resolved.",
    usedBy: "A2",
    response: Ask,
  }),
  lookingForMe: def({
    method: "GET",
    path: "/api/looking-for-me",
    description: "How many people have an open ask that this user could answer.",
    usedBy: "A1",
    response: z.object({ count: z.number().int().nonnegative() }),
  }),
} as const;

export type RouteName = keyof typeof routes;
export type RouteBody<N extends RouteName> = (typeof routes)[N] extends { body: infer B extends z.ZodTypeAny }
  ? z.output<B>
  : undefined;
export type RouteResponse<N extends RouteName> = z.infer<(typeof routes)[N]["response"]>;

/** What a handler, fake or real, receives. */
export interface Ctx<N extends RouteName> {
  userId: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: RouteBody<N>;
}

export type Handler<N extends RouteName> = (ctx: Ctx<N>) => Promise<RouteResponse<N>>;

export type Api = { [N in RouteName]: Handler<N> };
