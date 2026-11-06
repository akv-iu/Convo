"use client";

/**
 * A1 step 2: three quick questions, saved together as `filters` with
 * PUT /api/me (B2's handoff in db/Profile-API.md). Picking a workplace
 * fills in the country until the user chooses one themselves. The badge
 * fills in as they answer.
 *
 * It does not read GET /api/me first: in real mode that returns 409 until
 * these answers are saved, so this screen always starts empty.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge, BadgeChip } from "../_components/badge";
import { missingAnswers, missingMessage, questionOrder, saveErrorMessage, toFilters, type Answers, type Missing, type Workplace } from "./answers";
import { countries, countryName } from "./countries";
import { WorkplaceSearch } from "./workplace-search";

export const NEXT_STEP = "/onboarding/profile";

const questionClass = "flex flex-col gap-3 border-0 p-0";
const legendClass = "mb-3 text-xl font-bold leading-snug tracking-tight";
const errorClass = "text-sm font-medium text-[#c2410c] dark:text-[#fdba74]";

function Problem({ id, show, missing }: { id: string; show: boolean; missing: Missing }) {
  if (!show) return null;
  return (
    <p id={id} className={errorClass}>
      {missingMessage[missing]}
    </p>
  );
}

export function AboutYouForm() {
  const router = useRouter();
  const [workplace, setWorkplace] = useState<Workplace>(null);
  const [country, setCountry] = useState("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [hiring, setHiring] = useState<boolean | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sections = useRef<Record<Missing, HTMLFieldSetElement | null>>({ workplace: null, country: null, hiring: null });

  const answers: Answers = { workplace, country, hiring };
  const missing = missingAnswers(answers);
  const show = (m: Missing) => tried && missing.includes(m);

  function chooseWorkplace(w: Workplace) {
    setWorkplace(w);
    if (w?.kind === "org" && !countryTouched) setCountry(w.org.country.toUpperCase());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    setSaveError(null);
    const first = questionOrder.find((m) => missing.includes(m));
    if (first) {
      sections.current[first]?.querySelector<HTMLElement>("input, select, button")?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: toFilters(answers) }),
      });
      if (!res.ok) {
        setSaveError(saveErrorMessage(res.status, await res.json().catch(() => null)));
        return;
      }
      router.push(NEXT_STEP);
    } catch {
      setSaveError(saveErrorMessage(0, null));
    } finally {
      setSaving(false);
    }
  }

  const badge = (
    <Badge label={country ? countryName(country) : undefined}>
      <div className="flex flex-col gap-2 pt-4">
        <p className="text-xs text-muted">Works at</p>
        {workplace?.kind === "org" ? (
          <p className="font-semibold leading-snug">{workplace.org.name}</p>
        ) : workplace?.kind === "none" ? (
          <p className="font-semibold leading-snug">Independent</p>
        ) : (
          <span className="block h-2.5 w-3/5 rounded-full bg-[var(--skeleton)]" />
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {hiring === null ? (
            <BadgeChip className="w-20" />
          ) : (
            <BadgeChip className={hiring ? "bg-accent text-on-accent" : "bg-[var(--skeleton)]"}>
              {hiring ? "Hiring" : "Not hiring"}
            </BadgeChip>
          )}
        </div>
      </div>
    </Badge>
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
      <div className="flex flex-col">
        <h1 className="text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
          About you
        </h1>
        <p className="mt-3 max-w-md text-lg text-muted">Three quick answers so the right people can find you.</p>

        <div className="mt-8 flex flex-col gap-9">
          <fieldset
            ref={(el) => {
              sections.current.workplace = el;
            }}
            className={questionClass}
            aria-describedby={show("workplace") ? "workplace-problem" : undefined}
          >
            <legend className={legendClass}>Where do you work?</legend>
            <WorkplaceSearch value={workplace} onChange={chooseWorkplace} invalid={show("workplace")} />
            {workplace?.kind !== "org" && (
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
            <Problem id="workplace-problem" show={show("workplace")} missing="workplace" />
          </fieldset>

          <fieldset
            ref={(el) => {
              sections.current.country = el;
            }}
            className={questionClass}
          >
            <legend className={legendClass}>Where are you based?</legend>
            <select
              aria-label="Country"
              value={country}
              aria-invalid={show("country") || undefined}
              aria-describedby={show("country") ? "country-problem" : undefined}
              onChange={(e) => {
                setCountry(e.target.value);
                setCountryTouched(true);
              }}
              className="min-h-14 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[#c2410c]"
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
            <Problem id="country-problem" show={show("country")} missing="country" />
          </fieldset>

          <fieldset
            ref={(el) => {
              sections.current.hiring = el;
            }}
            className={questionClass}
            aria-describedby={show("hiring") ? "hiring-problem" : undefined}
          >
            <legend className={legendClass}>Are you hiring?</legend>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { value: true, label: "Yes, I'm hiring", hint: "People looking for jobs can find you." },
                { value: false, label: "Not right now", hint: "Career asks won't be sent to you." },
              ].map((o) => (
                <label
                  key={String(o.value)}
                  className="flex min-h-24 cursor-pointer flex-col justify-center rounded-xl border-2 border-border bg-surface px-4 py-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent motion-reduce:transition-none"
                >
                  <input
                    type="radio"
                    name="hiring"
                    checked={hiring === o.value}
                    onChange={() => setHiring(o.value)}
                    className="sr-only"
                  />
                  <span className="text-lg font-semibold leading-snug">{o.label}</span>
                  <span className="text-sm text-muted">{o.hint}</span>
                </label>
              ))}
            </div>
            <Problem id="hiring-problem" show={show("hiring")} missing="hiring" />
          </fieldset>
        </div>

        <div className="mt-8 lg:hidden">{badge}</div>

        <div className="sticky bottom-0 -mx-4 mt-8 bg-background/95 px-4 pb-4 pt-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          {saveError && (
            <p role="alert" className={`mb-3 ${errorClass}`}>
              {saveError}
              {saveError.startsWith("Your sign-in has expired") && (
                <>
                  {" "}
                  <a href="/signin" className="underline underline-offset-4">
                    Sign in again
                  </a>
                </>
              )}
            </p>
          )}
          <Button type="submit" disabled={saving} className="w-full text-lg sm:w-auto sm:px-8">
            {saving ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>

      <div className="hidden lg:block">{badge}</div>
    </form>
  );
}
