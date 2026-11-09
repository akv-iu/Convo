/**
 * Page two's Research and Public profile sections. Each shows at most four
 * suggestions from its own discovery; nothing is chosen automatically, and
 * opening a link never chooses it. Public profile also takes a different
 * HTTPS link or pasted text.
 */
import type { ReactNode } from "react";
import { MAX_SOURCE_TEXT } from "@/contracts/enrichment";
import type { RouteResponse } from "@/contracts/routes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { readReason, type Reason } from "../../_components/reasons";
import type { Failure } from "./api";
import { HowToFix } from "./how-to-fix";

type Discovery = RouteResponse<"discoverEnrichment">;

/** A discovery for one source: not asked yet, running, answered, or the request failed. */
export type Found<D> = null | { state: "loading" } | { state: "done"; value: D } | { state: "failed"; failure: Failure };

/** The public-profile choice on screen; null until the user picks something. */
export type ProfileMode = null | "none" | "url" | "text" | { candidateId: string };

const hintClass = "px-1 text-sm text-muted";
const errorClass = "text-sm font-medium text-[var(--danger)]";
const cardClass =
  "flex flex-col gap-2 rounded-xl border-2 border-border bg-surface px-4 py-3 has-[:checked]:border-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";
const radioClass = "mt-1 size-5 shrink-0 accent-accent focus-visible:outline-none";
const linkClass =
  "inline-flex min-h-11 w-fit items-center text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const fieldClass =
  "w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]";

/** A failed request's code as help: contract reasons as they are, anything else as unknown. */
export function reasonOf(failure: Failure): Reason {
  return readReason(failure.code) ?? "unknown";
}

function years(list: number[] | null): string {
  if (!list?.length) return "";
  const first = Math.min(...list);
  const last = Math.max(...list);
  return first === last ? ` (${first})` : ` (${first}–${last})`;
}

function Searching({ found, onRetry, children }: { found: Found<Discovery>; onRetry: () => void; children: (value: Discovery) => ReactNode }) {
  if (!found || found.state === "loading") return <p role="status" className={hintClass}>Looking…</p>;
  if (found.state === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <HowToFix reason={reasonOf(found.failure)} retryAfterSeconds={found.failure.retryAfterSeconds} />
        <Button variant="secondary" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children(found.value)}</>;
}

function Unavailable({ value, onRetry }: { value: Discovery; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <HowToFix reason={value.reason ?? "provider_down"} retryAfterSeconds={value.retryAfterSeconds} />
      <Button variant="secondary" className="self-start" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function ResearchSource({
  on,
  onToggle,
  found,
  onRetry,
  picked,
  onPick,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  found: Found<Discovery>;
  onRetry: () => void;
  /** A candidate ID, "none", or null before any choice (both of the last two skip). */
  picked: string | null;
  onPick: (picked: string) => void;
}) {
  return (
    <section aria-label="Research papers" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Switch label="Research papers" checked={on} onChange={onToggle} describedBy="research-hint" />
        <p id="research-hint" className={hintClass}>
          Papers listed on OpenAlex. Choosing an author tells Lanyard which papers to read; it doesn&apos;t prove they&apos;re yours.
        </p>
      </div>
      {on && (
        <Searching found={found} onRetry={onRetry}>
          {(value) => {
            if (value.source !== "research") return null;
            if (value.status === "unavailable") return <Unavailable value={value} onRetry={onRetry} />;
            if (value.status === "no_matches") return <HowToFix reason={value.reason ?? "research_no_match"} />;
            return (
              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 font-semibold">Which author is you?</legend>
                <p className={hintClass}>Check a link if you&apos;re not sure. Opening it doesn&apos;t choose it.</p>
                {value.candidates.map((c) => (
                  <div key={c.id} className={cardClass}>
                    <label className="flex cursor-pointer gap-3">
                      <input type="radio" name="research-author" checked={picked === c.id} onChange={() => onPick(c.id)} className={radioClass} />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-semibold break-words">{c.name}</span>
                        {c.affiliations.length > 0 && (
                          <span className="text-sm text-muted break-words">
                            {c.affiliations.map((a) => a.name + years(a.years)).join(" · ")}
                          </span>
                        )}
                        <span className="text-sm text-muted">
                          {c.worksCount} {c.worksCount === 1 ? "work" : "works"}
                        </span>
                        {c.samplePapers.length > 0 && (
                          <span className="mt-1 flex flex-col gap-0.5 text-sm">
                            {c.samplePapers.map((p) => (
                              <span key={p.title} className="break-words">
                                {p.title}
                                {p.year ? `, ${p.year}` : ""}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </label>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      View {c.name} on OpenAlex<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </div>
                ))}
                <label className={`${cardClass} cursor-pointer flex-row items-center gap-3`}>
                  <input type="radio" name="research-author" checked={picked === "none"} onChange={() => onPick("none")} className={radioClass} />
                  <span className="font-semibold">None of these</span>
                </label>
              </fieldset>
            );
          }}
        </Searching>
      )}
    </section>
  );
}

export function ProfileSource({
  on,
  onToggle,
  found,
  onRetry,
  mode,
  onMode,
  url,
  onUrl,
  text,
  onText,
  problem,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  found: Found<Discovery>;
  onRetry: () => void;
  mode: ProfileMode;
  onMode: (mode: Exclude<ProfileMode, null>) => void;
  url: string;
  onUrl: (url: string) => void;
  text: string;
  onText: (text: string) => void;
  problem: "profile_url" | "profile_text" | null;
}) {
  const picked = typeof mode === "object" && mode ? mode.candidateId : null;
  return (
    <section aria-label="Public profile page" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Switch label="Public profile page" checked={on} onChange={onToggle} describedBy="profile-hint" />
        <p id="profile-hint" className={hintClass}>
          A university or company page about you. Lanyard reads only the page you choose.
        </p>
      </div>
      {on && (
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 font-semibold">Which page is about you?</legend>
          <Searching found={found} onRetry={onRetry}>
            {(value) => {
              if (value.source !== "public_profile") return null;
              if (value.status === "unavailable") return <Unavailable value={value} onRetry={onRetry} />;
              if (value.status === "no_matches" || !value.candidates.length) {
                return <p className={hintClass}>No pages found. Give a link or paste text instead.</p>;
              }
              return (
                <>
                  <p className={hintClass}>Check a link if you&apos;re not sure. Opening it doesn&apos;t choose it.</p>
                  {value.candidates.map((c) => (
                    <div key={c.id} className={cardClass}>
                      <label className="flex cursor-pointer gap-3">
                        <input
                          type="radio"
                          name="profile-page"
                          checked={picked === c.id}
                          onChange={() => onMode({ candidateId: c.id })}
                          className={radioClass}
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-semibold break-words">{c.title}</span>
                          <span className="text-sm text-muted">{c.domain}</span>
                          {c.snippet && <span className="text-sm break-words">{c.snippet}</span>}
                        </span>
                      </label>
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        Open {c.domain}<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </div>
                  ))}
                </>
              );
            }}
          </Searching>
          <div className={cardClass}>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="radio" name="profile-page" checked={mode === "url"} onChange={() => onMode("url")} className="size-5 shrink-0 accent-accent focus-visible:outline-none" />
              <span className="font-semibold">Use a different link</span>
            </label>
            {mode === "url" && (
              <>
                <input
                  id="profile-url"
                  type="url"
                  aria-label="Link to your public profile page"
                  value={url}
                  placeholder="https://"
                  maxLength={2048}
                  aria-invalid={problem === "profile_url" || undefined}
                  aria-describedby={problem === "profile_url" ? "profile-url-problem" : undefined}
                  onChange={(e) => onUrl(e.target.value)}
                  className={fieldClass}
                />
                {problem === "profile_url" && (
                  <p id="profile-url-problem" className={errorClass}>
                    Enter the full link, starting with https://.
                  </p>
                )}
              </>
            )}
          </div>
          <div className={cardClass}>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="radio" name="profile-page" checked={mode === "text"} onChange={() => onMode("text")} className="size-5 shrink-0 accent-accent focus-visible:outline-none" />
              <span className="font-semibold">Paste text instead</span>
            </label>
            {mode === "text" && (
              <>
                <textarea
                  id="profile-text"
                  aria-label="Text about your professional work"
                  value={text}
                  rows={6}
                  maxLength={MAX_SOURCE_TEXT}
                  aria-invalid={problem === "profile_text" || undefined}
                  aria-describedby={`profile-text-count${problem === "profile_text" ? " profile-text-problem" : ""}`}
                  onChange={(e) => onText(e.target.value)}
                  className={fieldClass}
                />
                <p id="profile-text-count" className="text-sm text-muted">
                  {text.length.toLocaleString("en")} of {MAX_SOURCE_TEXT.toLocaleString("en")} characters. Kept private until you approve your bio.
                </p>
                {problem === "profile_text" && (
                  <p id="profile-text-problem" className={errorClass}>
                    Paste some text, or choose another option.
                  </p>
                )}
              </>
            )}
          </div>
          <label className={`${cardClass} cursor-pointer flex-row items-center gap-3`}>
            <input type="radio" name="profile-page" checked={mode === "none"} onChange={() => onMode("none")} className="size-5 shrink-0 accent-accent focus-visible:outline-none" />
            <span className="font-semibold">None of these</span>
          </label>
        </fieldset>
      )}
    </section>
  );
}
