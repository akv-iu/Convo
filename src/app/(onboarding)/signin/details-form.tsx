"use client";

/**
 * Profile enrichment's page one: name, workplace, country, an optional ORCID
 * iD and four independent sources. Nothing is sent yet: there is no account
 * until page two signs in, so the answers wait in this tab
 * (_components/draft.ts) and page two saves them after sign-in.
 *
 * The workplace is typed here because the directory search (/api/ror)
 * needs a signed-in user.
 */
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ENRICHMENT_RETURN_PATH } from "@/contracts/enrichment";
import { Button } from "@/components/ui/button";
import { countries } from "@/components/ui/countries";
import { Switch } from "@/components/ui/switch";
import { draftSnapshot, parseDraft, saveDraft, type Draft } from "../_components/draft";
import { DEFAULT_SOURCES, normaliseOrcid, type SourceChoices } from "../_components/enrichment";
import { consentSources } from "../consent";
import { aboutYouMissing, missingMessage, NAME_MAX, WORKPLACE_NAME_MAX, type Missing } from "../onboarding/answers";

type Problem = Exclude<Missing, "hiring"> | "orcid" | "github";

/** The control to focus for the first problem. */
const problemTarget: Record<Problem, string> = {
  name: "#details-name",
  workplace: "#details-workplace",
  country: "#details-country",
  orcid: "#details-orcid",
  github: "#details-github input",
};

const noSubscription = () => () => {};

const legendClass = "mb-3 text-xl font-bold leading-snug tracking-tight";
const errorClass = "text-sm font-medium text-[var(--danger)]";
const hintClass = "text-sm text-muted";
const inputClass =
  "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]";

/** consent.ts names GitHub's bio "profile"; the start request calls it "bio". */
const githubKey = { profile: "bio", repos: "repos", orgs: "orgs" } as const;

const otherSources = [
  { id: "research", label: "Research papers", hint: "Papers listed on OpenAlex. You'll pick which author is you." },
  { id: "publicProfile", label: "Public profile page", hint: "A university or company page about you. You'll pick it, give a link or paste text." },
  { id: "cv", label: "CV", hint: "A PDF or Word file, or pasted text. You'll choose which parts to use." },
] as const;

/**
 * Coming back from page two (or reloading) keeps what was typed. The tab's
 * draft is read after hydration (the server has none); a new draft remounts
 * the fields with it.
 */
export function DetailsForm() {
  const raw = useSyncExternalStore(noSubscription, draftSnapshot, () => null);
  return <DetailsFields key={raw ?? ""} initial={parseDraft(raw)} />;
}

function initialWorkplace(draft: Draft | null): string {
  if (draft?.workplace?.kind === "custom") return draft.workplace.name;
  if (draft?.workplace?.kind === "org") return draft.workplace.org.name;
  return "";
}

function DetailsFields({ initial }: { initial: Draft | null }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [workplaceText, setWorkplaceText] = useState(initialWorkplace(initial));
  const [noOrganisation, setNoOrganisation] = useState(initial?.workplace?.kind === "none");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [orcid, setOrcid] = useState(initial?.orcid ?? "");
  const [sources, setSources] = useState<SourceChoices>(initial?.sources ?? DEFAULT_SOURCES);
  const [tried, setTried] = useState(false);

  const typed = workplaceText.trim();
  let workplace: { kind: "custom"; name: string } | { kind: "none" } | null = null;
  if (noOrganisation) workplace = { kind: "none" };
  else if (typed) workplace = { kind: "custom", name: typed };
  const orcidValue = orcid.trim() ? normaliseOrcid(orcid) : null;
  const gh = sources.github;
  const problems: Problem[] = [
    ...aboutYouMissing({ name, workplace, country }).filter((m): m is Exclude<Missing, "hiring"> => m !== "hiring"),
    ...(orcid.trim() && !orcidValue ? (["orcid"] as const) : []),
    ...(gh.on && !gh.bio && !gh.repos && !gh.orgs ? (["github"] as const) : []),
  ];
  const show = (p: Problem) => tried && problems.includes(p);

  function setSource(id: (typeof otherSources)[number]["id"], on: boolean) {
    setSources((s) => ({ ...s, [id]: on }));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (problems.length || !workplace) {
      document.querySelector<HTMLElement>(problemTarget[problems[0] ?? "workplace"])?.focus();
      return;
    }
    saveDraft({ name: name.trim(), country: country.toUpperCase(), workplace, orcid: orcidValue, sources });
    router.push(ENRICHMENT_RETURN_PATH);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-xl flex-col">
      <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
        Make your badge
      </h1>
      <p className="mt-3 text-lg text-muted">
        Tell us who you are and where Lanyard may look. Nothing is read until you confirm your sources after signing in.
      </p>

      <div className="mt-8 flex flex-col gap-9">
        <div className="flex flex-col gap-2">
          <label htmlFor="details-name" className="text-xl font-bold leading-snug tracking-tight">
            Your name
          </label>
          <input
            id="details-name"
            type="text"
            value={name}
            autoComplete="name"
            maxLength={NAME_MAX + 20}
            aria-invalid={show("name") || undefined}
            aria-describedby={show("name") ? "details-name-problem" : undefined}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          {show("name") && (
            <p id="details-name-problem" className={errorClass}>
              {missingMessage.name}
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className={legendClass}>Where do you work?</legend>
          {!noOrganisation && (
            <input
              id="details-workplace"
              type="text"
              aria-label="Workplace"
              value={workplaceText}
              autoComplete="organization"
              maxLength={WORKPLACE_NAME_MAX}
              aria-invalid={show("workplace") || undefined}
              aria-describedby={show("workplace") ? "details-workplace-problem" : undefined}
              onChange={(e) => setWorkplaceText(e.target.value)}
              className={inputClass}
            />
          )}
          <label className="flex min-h-12 cursor-pointer items-center gap-3 self-start rounded-lg px-1 text-base has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            <input
              type="checkbox"
              checked={noOrganisation}
              onChange={(e) => setNoOrganisation(e.target.checked)}
              className="size-5 accent-accent focus-visible:outline-none"
            />
            Not with an organisation
          </label>
          {show("workplace") && (
            <p id="details-workplace-problem" className={errorClass}>
              {missingMessage.workplace}
            </p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3 border-0 p-0">
          <legend className={legendClass}>Where are you based?</legend>
          <select
            id="details-country"
            aria-label="Country"
            value={country}
            aria-invalid={show("country") || undefined}
            aria-describedby={show("country") ? "details-country-problem" : undefined}
            onChange={(e) => setCountry(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose a country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {show("country") && (
            <p id="details-country-problem" className={errorClass}>
              {missingMessage.country}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor="details-orcid" className="text-xl font-bold leading-snug tracking-tight">
            ORCID iD <span className="font-normal text-muted">(optional)</span>
          </label>
          <p id="details-orcid-hint" className={hintClass}>
            Helps find your papers. It&apos;s only used to look you up, never to sign in.
          </p>
          <input
            id="details-orcid"
            type="text"
            inputMode="text"
            value={orcid}
            placeholder="0000-0000-0000-0000"
            maxLength={60}
            autoComplete="off"
            aria-invalid={show("orcid") || undefined}
            aria-describedby={show("orcid") ? "details-orcid-hint details-orcid-problem" : "details-orcid-hint"}
            onChange={(e) => setOrcid(e.target.value)}
            className={inputClass}
          />
          {show("orcid") && (
            <p id="details-orcid-problem" className={errorClass}>
              That isn&apos;t a valid ORCID iD. Check the 16 characters, or leave it empty.
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-2.5 border-0 p-0">
          <legend className={legendClass}>Where should Lanyard look?</legend>
          <div className="flex flex-col gap-1">
            <Switch
              label="GitHub"
              checked={gh.on}
              describedBy="source-github-hint"
              onChange={(on) => setSources((s) => ({ ...s, github: { ...s.github, on } }))}
            />
            <p id="source-github-hint" className={`${hintClass} px-1`}>
              Your public bio, repositories and organisations. You can sign in with Google and still connect GitHub.
            </p>
          </div>
          {gh.on && (
            <fieldset id="details-github" className="ml-4 flex flex-col gap-1 border-0 border-l-2 border-l-border py-1 pl-4">
              <legend className="sr-only">What Lanyard may read from GitHub</legend>
              {consentSources.map((c) => (
                <label
                  key={c.id}
                  className="grid min-h-12 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-1 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                >
                  <input
                    type="checkbox"
                    checked={gh[githubKey[c.id]]}
                    aria-describedby={`details-${c.id}-hint`}
                    onChange={(e) => setSources((s) => ({ ...s, github: { ...s.github, [githubKey[c.id]]: e.target.checked } }))}
                    className="col-start-1 row-span-2 row-start-1 size-5 shrink-0 accent-accent focus-visible:outline-none"
                  />
                  <span className="col-start-2 row-start-1 font-semibold">{c.label}</span>
                  <span id={`details-${c.id}-hint`} className="col-start-2 row-start-2 text-sm text-muted">
                    {c.hint}
                  </span>
                </label>
              ))}
              {show("github") && (
                <p className={errorClass}>Choose at least one, or turn off GitHub.</p>
              )}
            </fieldset>
          )}
          {otherSources.map((s) => (
            <div key={s.id} className="flex flex-col gap-1">
              <Switch label={s.label} checked={sources[s.id]} describedBy={`source-${s.id}-hint`} onChange={(on) => setSource(s.id, on)} />
              <p id={`source-${s.id}-hint`} className={`${hintClass} px-1`}>
                {s.hint}
              </p>
            </div>
          ))}
        </fieldset>
      </div>

      {/* Sticky on phones; the page's scroll padding keeps a focused field above it. */}
      <div className="sticky bottom-0 -mx-4 mt-8 flex items-center gap-3 bg-background/95 px-4 pb-4 pt-3 backdrop-blur max-sm:[html:has(&)]:scroll-pb-24 sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <Button type="submit" className="flex-1 text-lg sm:flex-none sm:px-10">
          Continue
        </Button>
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="grid size-5 place-items-center rounded-full border border-current text-[11px] font-bold">
              i
            </span>
            Your data
          </summary>
          <p className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-xl border border-border bg-surface p-4 text-sm text-foreground shadow-[var(--popover-shadow)] sm:left-0 sm:right-auto">
            Signing in only creates or opens your account. Lanyard reads a source only if it&apos;s still on when you press
            Continue on the next page, and nothing is posted anywhere. You review your bio before anyone sees it.
          </p>
        </details>
      </div>
    </form>
  );
}
