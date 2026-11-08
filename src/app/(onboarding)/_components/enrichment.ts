/**
 * Profile enrichment's page-one choices and how page two turns them into the
 * contract's start request (src/contracts/enrichment.ts). Pure, so it's
 * unit-tested; the screens own the state and the requests.
 */
import { z } from "zod";
import type { RouteBody } from "@/contracts/routes";
import type { RorMatch } from "@/contracts/types";

export const SourceChoices = z.object({
  github: z.object({ on: z.boolean(), bio: z.boolean(), repos: z.boolean(), orgs: z.boolean() }),
  research: z.boolean(),
  publicProfile: z.boolean(),
  cv: z.boolean(),
});
export type SourceChoices = z.infer<typeof SourceChoices>;

/** GitHub, research and a public page start on; CV starts off because it needs a file. */
export const DEFAULT_SOURCES: SourceChoices = {
  github: { on: true, bio: true, repos: true, orgs: true },
  research: true,
  publicProfile: true,
  cv: false,
};

export type Identity = RouteBody<"saveEnrichmentIdentity">;
export type StartBody = Omit<RouteBody<"startEnrichment">, "idempotencyKey">;

/** One chosen candidate from a discovery. */
export interface Selection {
  discoveryId: string;
  candidateId: string;
}

/** The public-profile choice; null means nothing chosen, which is sent as a skip. */
export type ProfileChoice =
  | ({ kind: "candidate" } & Selection)
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | null;

export interface Picks {
  research: Selection | null;
  publicProfile: ProfileChoice;
  cvUploadId: string | null;
}

type Workplace = { kind: "org"; org: RorMatch } | { kind: "custom"; name: string } | { kind: "none" } | null;

function workplaceName(w: Workplace): string | null {
  if (w?.kind === "custom") return w.name.trim();
  if (w?.kind === "org") return w.org.name;
  return null;
}

/** Page one's answers as the contract's identity. A typed workplace has no directory ID yet. */
export function identityFrom(d: { name: string; country: string; workplace: Workplace; orcid?: string | null }): Identity {
  return {
    name: d.name.trim(),
    country: d.country.toUpperCase(),
    workplaceName: workplaceName(d.workplace),
    rorId: d.workplace?.kind === "org" ? d.workplace.org.id : null,
    orcid: d.orcid ?? null,
  };
}

export function sameIdentity(a: Identity | null, b: Identity | null): boolean {
  if (!a || !b) return a === b;
  return a.name === b.name && a.country === b.country && a.workplaceName === b.workplaceName && a.rorId === b.rorId && a.orcid === b.orcid;
}

/**
 * The start request: off is null, on with nothing chosen is a skip. GitHub
 * off sends every category off, because that never signs anyone out.
 */
export function startBody(identity: Identity, sources: SourceChoices, picks: Picks): StartBody {
  const gh = sources.github;
  return {
    identity,
    github: gh.on ? { import: true, bio: gh.bio, repos: gh.repos, orgs: gh.orgs } : { import: false, bio: false, repos: false, orgs: false },
    research: sources.research ? (picks.research ?? { skip: true }) : null,
    publicProfile: sources.publicProfile ? profileSelection(picks.publicProfile) : null,
    cv: sources.cv && picks.cvUploadId ? { uploadId: picks.cvUploadId } : null,
  };
}

function profileSelection(page: ProfileChoice): NonNullable<StartBody["publicProfile"]> {
  if (!page) return { skip: true };
  if (page.kind === "candidate") return { discoveryId: page.discoveryId, candidateId: page.candidateId };
  if (page.kind === "url") return { url: page.url };
  return { kind: "text", text: page.text };
}

export type StartProblem = "github_categories" | "github_connect" | "profile_url" | "profile_text" | "cv_missing";

/** What still stops page two's Continue, in screen order. */
export function startProblems(
  sources: SourceChoices,
  picks: Picks,
  status: { github: { connected: boolean }; profileUrlValid: boolean },
): StartProblem[] {
  const problems: StartProblem[] = [];
  const gh = sources.github;
  if (gh.on && !gh.bio && !gh.repos && !gh.orgs) problems.push("github_categories");
  if (gh.on && !status.github.connected) problems.push("github_connect");
  if (sources.publicProfile && picks.publicProfile?.kind === "url" && !status.profileUrlValid) problems.push("profile_url");
  if (sources.publicProfile && picks.publicProfile?.kind === "text" && !picks.publicProfile.text.trim()) problems.push("profile_text");
  if (sources.cv && !picks.cvUploadId) problems.push("cv_missing");
  return problems;
}

export interface StartKey {
  key: string;
  fingerprint: string;
}

/** Keep the key while the request is unchanged (a retry); any change gets a new one, as the contract asks. */
export function keyFor(body: StartBody, previous: StartKey | null, newKey: () => string = () => crypto.randomUUID()): StartKey {
  const fingerprint = JSON.stringify(body);
  return previous?.fingerprint === fingerprint ? previous : { key: newKey(), fingerprint };
}

/** "https://orcid.org/0000-0002-1825-0097", spaces or no hyphens → "0000-0002-1825-0097"; null unless the check digit matches. */
export function normaliseOrcid(input: string): string | null {
  const compact = input
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return null;
  // ISO 7064 MOD 11-2, as ORCID documents it.
  let total = 0;
  for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
  const result = (12 - (total % 11)) % 11;
  if (compact[15] !== (result === 10 ? "X" : String(result))) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12)}`;
}
