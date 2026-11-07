"use client";

/**
 * Step 1: the minimum to start searching (name, workplace, country) and
 * where Convo should look. Continue keeps the answers in this tab (see
 * _components/draft.ts) and runs the server action, which saves the
 * consent choice and starts GitHub sign-in (or skips it on the fake API).
 *
 * Only GitHub works today. Research papers and CV/LinkedIn upload are
 * shown as coming soon until Person B adds their backends, and GitHub is
 * required because it's the only way to sign in.
 */
import { Fragment, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { saveDraft } from "../_components/draft";
import { consentSources } from "../consent";
import { aboutYouMissing, missingMessage, NAME_MAX, type Missing, type Workplace } from "../onboarding/answers";
import { countries } from "../onboarding/countries";
import { WorkplaceSearch } from "../onboarding/workplace-search";

const sources = [
  {
    id: "github",
    label: "GitHub",
    hint: "You'll sign in with GitHub next. Choose what Convo may read below.",
    ready: true,
  },
  {
    id: "papers",
    label: "Research papers",
    hint: "Papers and projects that match your name and workplace.",
    ready: false,
  },
  {
    id: "cv",
    label: "CV or LinkedIn",
    hint: "Upload your CV or your LinkedIn data export.",
    ready: false,
  },
] as const;

const legendClass = "mb-3 text-xl font-bold leading-snug tracking-tight";
const errorClass = "text-sm font-medium text-[var(--danger)]";
const inputClass =
  "min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]";

export function StartForm({ action, demo }: { action: (formData: FormData) => Promise<void>; demo: boolean }) {
  const [name, setName] = useState("");
  const [workplace, setWorkplace] = useState<Workplace>(null);
  const [country, setCountry] = useState("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [github, setGithub] = useState(true);
  // Per-source consent under GitHub (PRD: per-source consent at sign-in). All on to start; any can be turned off.
  const [consent, setConsent] = useState<Set<string>>(() => new Set(consentSources.map((s) => s.id)));
  const [tried, setTried] = useState(false);
  const sections = useRef<Record<Exclude<Missing, "hiring"> | "github", HTMLElement | null>>({
    name: null,
    workplace: null,
    country: null,
    github: null,
  });

  const missing = aboutYouMissing({ name, workplace, country });
  const show = (m: Missing) => tried && missing.includes(m);
  const githubProblem = tried && !github;

  function chooseWorkplace(w: Workplace) {
    setWorkplace(w);
    if (w?.kind === "org" && !countryTouched) setCountry(w.org.country.toUpperCase());
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    setTried(true);
    const first = missing[0] ?? (!github ? "github" : null);
    if (first || !workplace) {
      e.preventDefault();
      const section = sections.current[(first ?? "workplace") as keyof typeof sections.current];
      section?.querySelector<HTMLElement>("input:not([disabled]), select, button")?.focus();
      return;
    }
    // Held in this tab until step 2 saves it (no account exists before sign-in).
    saveDraft({ name: name.trim(), country: country.toUpperCase(), workplace });
  }

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="mx-auto flex max-w-xl flex-col">
      <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
        Make your badge
      </h1>
      <p className="mt-3 text-lg text-muted">Convo fills it in from your public info such as GitHub.</p>

      <div className="mt-8 flex flex-col gap-9">
        <div
          className="flex flex-col gap-2"
          ref={(el) => {
            sections.current.name = el;
          }}
        >
          <label htmlFor="start-name" className="text-xl font-bold leading-snug tracking-tight">
            Your name
          </label>
          <input
            id="start-name"
            type="text"
            value={name}
            autoComplete="name"
            maxLength={NAME_MAX + 20}
            aria-invalid={show("name") || undefined}
            aria-describedby={show("name") ? "start-name-problem" : undefined}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          {show("name") && (
            <p id="start-name-problem" className={errorClass}>
              {missingMessage.name}
            </p>
          )}
        </div>

        <fieldset
          className="flex flex-col gap-3 border-0 p-0"
          aria-describedby={show("workplace") ? "start-workplace-problem" : undefined}
          ref={(el) => {
            sections.current.workplace = el;
          }}
        >
          <legend className={legendClass}>Where do you work?</legend>
          <WorkplaceSearch value={workplace} onChange={chooseWorkplace} invalid={show("workplace")} />
          {(workplace === null || workplace.kind === "none") && (
            <label className="flex min-h-12 cursor-pointer items-center gap-3 self-start rounded-lg px-1 text-base has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
              <input
                type="checkbox"
                checked={workplace?.kind === "none"}
                onChange={(e) => chooseWorkplace(e.target.checked ? { kind: "none" } : null)}
                className="size-5 accent-accent focus-visible:outline-none"
              />
              Not with an organisation
            </label>
          )}
          {show("workplace") && (
            <p id="start-workplace-problem" className={errorClass}>
              {missingMessage.workplace}
            </p>
          )}
        </fieldset>

        <fieldset
          className="flex flex-col gap-3 border-0 p-0"
          ref={(el) => {
            sections.current.country = el;
          }}
        >
          <legend className={legendClass}>Where are you based?</legend>
          <select
            aria-label="Country"
            value={country}
            aria-invalid={show("country") || undefined}
            aria-describedby={show("country") ? "start-country-problem" : undefined}
            onChange={(e) => {
              setCountry(e.target.value);
              setCountryTouched(true);
            }}
            className={inputClass}
          >
            <option value="">Choose a country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {workplace?.kind === "org" && !countryTouched && country && (
            <p className="text-sm text-muted">Filled in from your workplace. Change it if you&apos;re based elsewhere.</p>
          )}
          {show("country") && (
            <p id="start-country-problem" className={errorClass}>
              {missingMessage.country}
            </p>
          )}
        </fieldset>

        <fieldset
          className="border-0 p-0"
          ref={(el) => {
            sections.current.github = el;
          }}
        >
          <legend className={legendClass}>Where should we look?</legend>
          <div className="flex flex-col gap-2.5">
            {sources.map((s) => (
              <Fragment key={s.id}>
                <label
                  className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl border-2 border-border bg-surface px-4 py-3 transition-colors has-[:checked]:border-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none ${s.ready ? "cursor-pointer" : "cursor-not-allowed"}`}
                >
                  <span className="col-start-1 row-start-1 flex flex-wrap items-center gap-2 text-lg font-semibold leading-snug">
                    {s.label}
                    {!s.ready && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">
                        Coming soon
                      </span>
                    )}
                  </span>
                  <span id={`source-${s.id}-hint`} className="col-start-1 row-start-2 block text-sm text-muted">
                    {s.hint}
                  </span>
                  <input
                    type="checkbox"
                    name={s.id}
                    checked={s.id === "github" ? github : false}
                    disabled={!s.ready}
                    onChange={s.id === "github" ? (e) => setGithub(e.target.checked) : undefined}
                    aria-describedby={`source-${s.id}-hint`}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="relative col-start-2 row-span-2 row-start-1 h-7 w-12 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-accent peer-disabled:opacity-50 motion-reduce:transition-none after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-5 motion-reduce:after:transition-none"
                  />
                </label>
                {s.id === "github" && github && (
                  <fieldset className="ml-4 flex flex-col gap-1 border-0 border-l-2 border-l-border py-1 pl-4">
                    <legend className="sr-only">What Convo may read from GitHub</legend>
                    <p className="text-sm text-muted" aria-hidden="true">
                      From GitHub, Convo may read:
                    </p>
                    {consentSources.map((c) => (
                      <label
                        key={c.id}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                      >
                        <input
                          type="checkbox"
                          name="consent"
                          value={c.id}
                          checked={consent.has(c.id)}
                          onChange={(e) =>
                            setConsent((cur) => {
                              const next = new Set(cur);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                          aria-describedby={`consent-${c.id}-hint`}
                          className="size-5 shrink-0 accent-accent focus-visible:outline-none"
                        />
                        <span>
                          <span className="block font-semibold">{c.label}</span>
                          <span id={`consent-${c.id}-hint`} className="block text-sm text-muted">
                            {c.hint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </Fragment>
            ))}
          </div>
          {githubProblem && (
            <p className={`mt-3 ${errorClass}`}>For now GitHub is how you sign in, so keep it on.</p>
          )}
        </fieldset>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-8 flex items-center gap-3 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
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
            We only use public info and anything you upload, and we never post to GitHub. Turning a source off means
            Convo won&apos;t read it next time you sign in. Your saved bio and organisations stay until you edit them;
            turning off repositories also removes your repo highlights.
          </p>
        </details>
      </div>
      {demo && <p className="mt-3 text-xs text-muted">Demo mode: this skips GitHub.</p>}
    </form>
  );
}
