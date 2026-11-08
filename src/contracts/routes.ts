/**
 * The API contract: every route the screens may call, with its request and
 * response schemas. The fake API and the real API both implement this list,
 * and /dev/routes renders it. Frozen after checkpoint C0.
 */
import { z } from "zod";
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
    body: Person.partial().omit({ id: true, synthetic: true }),
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
    description:
      "Swipe right: send the refined question to a person, with an optional note to them. One request per person per ask; sending again returns it.",
    usedBy: "A2",
    body: z.object({ askId: z.string(), toPersonId: z.string(), message: z.string().trim().max(500).optional() }),
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
