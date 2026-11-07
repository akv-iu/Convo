/**
 * The ask box and refine screen's logic (A1 step 5), kept apart from the
 * screen so it can be unit-tested.
 *
 * POST /api/refine creates a new ask each time (db/Ask-Matching.md), and
 * the contract has no route to edit or read one back. So the screen offers
 * "Ask something else" (a new ask), never "edit", and keeps a copy of each
 * refined ask in this tab for the matches screen to show its question.
 * That copy is a display cache only: the server's saved ask is what
 * matching and requests use.
 */
import { z } from "zod";
import { AskType, RefinedAsk } from "@/contracts/types";

export const ASK_MIN = 3; // routes.refine body: text.min(3)
export const ASK_MAX = 500;

export const typeLabel: Record<AskType, string> = {
  knowledge: "Learn something",
  career: "Career move",
  collaboration: "Build together",
  hiring: "Hiring",
};

/** "10-minute chat". */
export function lengthLabel(minutes: number): string {
  return `${minutes}-minute chat`;
}

/** Why the ask box can't be sent yet, or null. */
export function askProblem(text: string): string | null {
  const t = text.trim();
  if (t.length < ASK_MIN) return "Write a few words about what you want to ask.";
  if (t.length > ASK_MAX) return `Keep it under ${ASK_MAX} characters.`;
  return null;
}

export type RefineFailure = {
  message: string;
  /** A link that fixes it, when retrying can't. */
  action: { label: string; href: string } | null;
};

/** What a failed POST /api/refine tells the user, from its status and `{ error }` body. */
export function refineFailure(status: number, body: unknown): RefineFailure {
  const server =
    typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
  // 422: moderation flagged it. The server's message is written for this screen; nothing was saved.
  if (status === 422) return { message: server ?? "This question can't be sent. Please rephrase it.", action: null };
  if (status === 409) return { message: "Finish setting up your badge first.", action: { label: "Set up your badge", href: "/signin" } };
  if (status === 401 || status === 404) return { message: "Your sign-in has expired.", action: { label: "Sign in again", href: "/signin" } };
  if (status === 400) return { message: "Write a few words about what you want to ask.", action: null };
  if (status === 503) return { message: server ?? "Lanyard couldn't sharpen that just now. Try again in a moment.", action: null };
  return { message: "Lanyard couldn't sharpen that just now. Try again in a moment.", action: null };
}

export const SavedAsk = z.object({ askId: z.string().min(1), rawText: z.string(), refined: RefinedAsk });
export type SavedAsk = z.infer<typeof SavedAsk>;

const KEY = "convo_asks";
const KEEP = 10;

function readAll(): SavedAsk[] {
  try {
    const parsed = z.array(SavedAsk).safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Keep a refined ask in this tab (newest first, last 10) for the matches screen. */
export function rememberAsk(ask: SavedAsk): void {
  try {
    const rest = readAll().filter((a) => a.askId !== ask.askId);
    sessionStorage.setItem(KEY, JSON.stringify([ask, ...rest].slice(0, KEEP)));
  } catch {
    // Storage unavailable: the matches screen still works, without the question shown.
  }
}

export function recallAsk(askId: string): SavedAsk | null {
  return readAll().find((a) => a.askId === askId) ?? null;
}

/** The "looking for you" banner's wording (A1 step 6): a big number, then the rest. */
export function lookingLabel(count: number): { number: string; text: string } {
  if (count <= 0) return { number: "No one", text: "is asking for someone like you yet. Check back later." };
  if (count === 1) return { number: "1", text: "person here is looking for someone like you" };
  return { number: count.toLocaleString("en-US"), text: "people here are looking for someone like you" };
}
