/**
 * Help for each sanitized import result the contract can send
 * (EnrichmentReason), following the brief's "How to fix this" table. It never
 * claims a profile is private or blocks access: the backend's code says what
 * is known, and missing data can be a valid result.
 */
import type { z } from "zod";
import { EnrichmentReason } from "@/contracts/enrichment";

export type Reason = z.infer<typeof EnrichmentReason>;

export const reasonHelp: Record<Reason, { title: string; fix: string }> = {
  sign_in_cancelled: {
    title: "Sign-in was cancelled",
    fix: "Your details are still here. Choose Google or GitHub to continue.",
  },
  github_connect_cancelled: {
    title: "GitHub wasn't connected",
    fix: "You're still signed in. Try connecting again, or turn off GitHub import.",
  },
  github_linked_elsewhere: {
    title: "This GitHub already belongs to another Lanyard account",
    fix: "Lanyard never merges accounts. Sign in with that GitHub instead, or turn off GitHub import here.",
  },
  github_not_connected: {
    title: "GitHub isn't connected",
    fix: "Connect GitHub, or turn off its import.",
  },
  github_reconnect: {
    title: "GitHub needs reconnecting",
    fix: "The connection expired or was revoked. Reconnect GitHub, or turn off its import. GitHub Settings → Applications → Authorized OAuth Apps shows the access you've given, where Lanyard may be listed as Convo.",
  },
  github_nothing_public: {
    title: "No public GitHub information found",
    fix: "GitHub returned nothing public for what you chose, which is fine. Use another source or write your bio yourself. Organisations only show if your membership is public; changing that is up to you.",
  },
  research_no_match: {
    title: "No confident match among research authors",
    fix: "Check your name and workplace on the first page, add your ORCID iD, or skip research papers.",
  },
  page_blocked: {
    title: "This page can't be imported automatically",
    fix: "Give another public link, or paste the text instead.",
  },
  page_unavailable: {
    title: "This page couldn't be reached",
    fix: "Check the link, try another public page, or paste the text instead.",
  },
  cv_unreadable: {
    title: "This document can't be read",
    fix: "Scanned or image-only files aren't supported. Use a text-based PDF or Word file, or paste the text.",
  },
  cv_encrypted: {
    title: "This PDF is password-protected",
    fix: "Remove the password and upload it again, or paste the text.",
  },
  cv_too_large: {
    title: "This file is over 2 MB",
    fix: "Use a smaller PDF or Word file, or paste the text.",
  },
  cv_unsupported: {
    title: "Only PDF and Word (.docx) files work",
    fix: "Save it as a PDF or .docx file, or paste the text.",
  },
  cv_expired: {
    title: "Your uploaded CV expired",
    fix: "Uploads are kept for a day. Upload it again or paste the text.",
  },
  cv_truncated: {
    title: "Only the first 30,000 characters were kept",
    fix: "If the parts you care about come later, paste them instead.",
  },
  rate_limited: {
    title: "Too many requests right now",
    fix: "Wait a moment and try again. Your other choices are kept.",
  },
  timeout: {
    title: "This took too long",
    fix: "Try again. Your other choices are kept.",
  },
  provider_down: {
    title: "This service isn't available right now",
    fix: "Try again later, use another source, or continue without it.",
  },
  unknown: {
    title: "This import isn't available",
    fix: "Try again, use another source, or continue without it.",
  },
};

/** A reason from the address bar, or null for anything that isn't a known code. */
export function readReason(value: unknown): Reason | null {
  const parsed = EnrichmentReason.safeParse(value);
  return parsed.success ? parsed.data : null;
}
