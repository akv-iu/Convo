import type { AskType } from "@/contracts/types";
import type { AiService } from "./index";
import { AskBlockedError } from "./blocked";
import { MEETING_MINUTES } from "./minutes";

function classify(text: string): AskType {
  const t = text.toLowerCase();
  if (/\b(job|hire|hiring|role|career|interview|referral)\b/.test(t)) return "career";
  if (/\b(collaborat|co-author|work together|partner)/.test(t)) return "collaboration";
  if (/\b(looking for|recruit|candidate)/.test(t)) return "hiring";
  return "knowledge";
}

/** Deterministic stand-in for the model; tests and the fake API rely on it costing nothing. */
export const cannedAi: AiService = {
  async refineAsk(rawText) {
    // Stands in for moderation, so the blocked-ask screen can be built with the fake API.
    if (/\bidiot\b/i.test(rawText)) throw new AskBlockedError();
    const type = classify(rawText);
    const trimmed = rawText.trim().replace(/[.?!]+$/, "");
    const text =
      type === "career"
        ? `${trimmed}: what does the hiring loop look like, and what would make my application stand out?`
        : `${trimmed}: can you walk me through the mechanism and the one thing people usually get wrong?`;
    return { text, type, minutes: MEETING_MINUTES };
  },

  async explain(ask, candidates) {
    return candidates.map((c) =>
      c.highlights.length ? `Evidence: ${c.highlights[0]}.` : `Profile mentions what you're asking about.`,
    );
  },
};
