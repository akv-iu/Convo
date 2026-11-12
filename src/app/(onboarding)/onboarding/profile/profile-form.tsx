"use client";

/**
 * Step 4, "Your details": shows what was found about the user (the profile
 * from GET /api/me, as their badge) and asks "Are these the correct
 * details?".
 * - Yes finishes onboarding without saving anything.
 * - No (or tapping a part of the badge) opens the editor: name, bio,
 *   skills and organisations, plus adding more by upload (coming soon,
 *   needs Person B's upload route). Saving sends only what changed with
 *   PUT /api/me (db/Profile-API.md).
 * The colour is chosen on step 2; this step's badge inherits it.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Person } from "@/contracts/types";
import { Badge, BadgeBar, BadgeChip } from "../../_components/badge";
import { BadgeCountry, BadgeLines } from "../../_components/badge-lines";
import { clearOnboardingTab } from "../../_components/draft";
import { showSavedColour } from "../../_components/badge-prefs";
import { aboutFromProfile, saveErrorMessage, SHOW_ALL, workplaceLabel } from "../answers";
import { colourHex } from "@/components/ui/badge-colours";
import { countryName } from "@/components/ui/countries";
import { ChipEditor } from "./chip-editor";
import { SeenByOthers, useVisibilitySave } from "./seen-by-others";
import { ContactSection, useContactDetails } from "./contact-details";
import { addPending, changesFrom, draftFrom, LIMITS, loadProblem, nameProblem, type Draft } from "./edits";

export const NEXT_STEP = "/ask";

const FIELD = {
  name: "profile-name",
  bio: "profile-bio",
  skills: "profile-skill",
  orgs: "profile-org",
} as const;
type Field = (typeof FIELD)[keyof typeof FIELD];

const inputClass =
  "w-full rounded-xl border-2 border-border bg-surface px-4 text-lg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]";
const errorClass = "text-sm font-medium text-[var(--danger)]";
const headingClass =
  "text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-6xl";
const HEADING = "Are these the correct details?";

type Load = { state: "loading" } | { state: "failed"; status: number } | { state: "ready"; person: Person };

/**
 * A badge row: tapping it opens the editor at its field (or moves there,
 * when already editing). Pointer only, like the rest of the aria-hidden
 * badge; keyboard and screen-reader users have the form's own fields. Not a
 * <label>, which would add the badge's text to the field's accessible name.
 */
function BadgeRow({
  field,
  caption,
  onOpen,
  children,
}: {
  field: Field;
  caption: string;
  onOpen: (field: Field) => void;
  children: ReactNode;
}) {
  const className = "-mx-2 mt-3 block w-[calc(100%+1rem)] cursor-pointer rounded-lg px-2 py-1 text-left hover:bg-accent/10";
  return (
    <span role="presentation" onClick={() => onOpen(field)} className={className}>
      <span className="block text-xs text-muted">{caption}</span>
      {children}
    </span>
  );
}

export function ProfileForm() {
  const router = useRouter();
  const contact = useContactDetails();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  /** Show/hide choices save at once, from the badge's erasers or the switches below it. */
  const visibilitySaver = useVisibilitySave((saved) => setLoad({ state: "ready", person: saved }));
  const [attempt, setAttempt] = useState(0);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"review" | "edit">("review");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** What's still typed in each Add box, and its problem; added on save (addPending). */
  const [pending, setPending] = useState({
    languages: { text: "", problem: null as string | null },
    organisations: { text: "", problem: null as string | null },
  });
  /** Set by a failed save: the next save is sent even with no changes (see submit). */
  const [mustResend, setMustResend] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!live) return;
        if (!res.ok) return setLoad({ state: "failed", status: res.status });
        const person = (await res.json()) as Person;
        if (!live) return;
        showSavedColour(person.badgeColour); // the saved colour wins over this browser's preview cookie
        setOriginal(draftFrom(person));
        setDraft(draftFrom(person));
        setLoad({ state: "ready", person });
      } catch {
        if (live) setLoad({ state: "failed", status: 0 });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);

  if (load.state === "loading" || (load.state === "ready" && (!draft || !original))) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16" aria-busy="true">
        <div>
          <h1 className={headingClass}>{HEADING}</h1>
          <p role="status" className="mt-3 text-lg text-muted">
            Loading what we found…
          </p>
        </div>
        <div className="hidden lg:block motion-safe:animate-pulse">
          <Badge>
            <span className="flex flex-col gap-1.5 pt-4">
              <BadgeBar className="w-full" />
              <BadgeBar className="w-3/5" />
            </span>
          </Badge>
        </div>
      </div>
    );
  }

  if (load.state === "failed") {
    const problem = loadProblem(load.status);
    return (
      <div className="max-w-md">
        <h1 className={headingClass}>{HEADING}</h1>
        <p role="alert" className="mt-4 text-lg">
          {problem.message}
        </p>
        <div className="mt-6">
          {problem.action ? (
            <Button href={problem.action.href}>{problem.action.label}</Button>
          ) : (
            <Button onClick={() => (setLoad({ state: "loading" }), setAttempt((n) => n + 1))}>Try again</Button>
          )}
        </div>
      </div>
    );
  }

  // ready
  const person = load.person;
  const d = draft!;
  const o = original!;
  const editing = mode === "edit";
  const nameIssue = tried ? nameProblem(d) : null;
  const update = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });

  /** Open the editor and put the cursor where the user tapped (after React has rendered the editor). */
  function startEditing(field: Field) {
    setMode("edit");
    setTimeout(() => document.getElementById(field)?.focus(), 0);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    setSaveError(null);
    if (nameProblem(d)) {
      nameRef.current?.focus();
      return;
    }
    // Anything still typed in an Add box counts, as if Add had been pressed.
    let next = d;
    for (const [key, field] of [
      ["languages", FIELD.skills],
      ["organisations", FIELD.orgs],
    ] as const) {
      if (!pending[key].text.trim()) continue;
      const added = addPending(next[key], pending[key].text);
      if (added.problem) {
        setPending((p) => ({ ...p, [key]: { ...p[key], problem: added.problem } }));
        document.getElementById(field)?.focus();
        return;
      }
      next = { ...next, [key]: added.list };
    }
    if (next !== d) {
      setDraft(next);
      setPending({ languages: { text: "", problem: null }, organisations: { text: "", problem: null } });
    }
    const changes = changesFrom(o, next);
    setSaving(true);
    try {
      // After a failed save, always save again, even with nothing changed: a 503 can leave the
      // profile saved but out of search (and everyone's matches); PUT {} is the documented repair.
      if (mustResend || Object.keys(changes).length) {
        const res = await fetch("/api/me", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
        if (!res.ok) {
          setMustResend(true);
          setSaveError(saveErrorMessage(res.status, await res.json().catch(() => null)));
          return;
        }
        setMustResend(false);
      }
      clearOnboardingTab(); // onboarding is done
      router.push(NEXT_STEP);
    } catch {
      setMustResend(true);
      setSaveError(saveErrorMessage(0, null));
    } finally {
      setSaving(false);
    }
  }

  const row = { onOpen: startEditing };
  // The same hiding rules as step 2: hidden lines aren't on the badge, and an eraser hides one.
  const visibility = person.visibility ?? SHOW_ALL;
  const hide = (section: keyof typeof visibility) => void visibilitySaver.save({ ...visibility, [section]: false });
  const badge = (
    <Badge
      name={d.name.trim() || "Your name"}
      handle={person.githubLogin}
      avatar={person.avatar}
      avatarColour={person.avatarColour ? colourHex(person.avatarColour) : undefined}
      label={<BadgeCountry country={countryName(person.filters.country)} shown={visibility.country} onHide={hide} />}
      onName={() => startEditing(FIELD.name)}
    >
      <BadgeLines workplace={workplaceLabel(aboutFromProfile(person).workplace)} hiring={person.filters.hiring} visibility={visibility} onHide={hide} />
      <BadgeRow {...row} field={FIELD.bio} caption="Bio">
        {d.bio.trim() ? (
          <span className="block text-sm leading-snug break-words">{d.bio.trim()}</span>
        ) : (
          <span className="block text-sm text-muted">+ Add a bio</span>
        )}
      </BadgeRow>
      <BadgeRow {...row} field={FIELD.skills} caption="Can help with">
        <span className="flex flex-wrap gap-1.5 pt-1">
          {d.languages.length ? (
            d.languages.map((l) => (
              <BadgeChip key={l} className="bg-accent/20">
                {l}
              </BadgeChip>
            ))
          ) : (
            <span className="text-sm text-muted">+ Add skills</span>
          )}
        </span>
      </BadgeRow>
      <BadgeRow {...row} field={FIELD.orgs} caption="Part of">
        <span className="flex flex-wrap gap-1.5 pt-1">
          {d.organisations.length ? (
            d.organisations.map((org) => <BadgeChip key={org}>{org}</BadgeChip>)
          ) : (
            <span className="text-sm text-muted">+ Add organisations</span>
          )}
        </span>
      </BadgeRow>
    </Badge>
  );

  if (!editing) {
    return (
      <div className="flex flex-col">
        <h1 className={headingClass}>{HEADING}</h1>
        <p className="mt-3 max-w-md text-lg text-muted">Here&apos;s what we found from your public info.</p>
        {/*
          Your badge on the left; on the right, the row other people see (your public profile) with
          what to hide right under it. One column on phones: badge, then the public row.
        */}
        <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-12">
          <div>{badge}</div>
          <SeenByOthers person={person} saver={visibilitySaver} />
        </div>
        <ContactSection contact={contact} />
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => void contact.save().then((ok) => ok && (clearOnboardingTab(), router.push(NEXT_STEP)))}
            disabled={contact.saving}
            className="text-lg sm:px-8"
          >
            {contact.saving ? "Saving…" : "Yes, that's me"}
          </Button>
          <Button variant="secondary" onClick={() => startEditing(FIELD.name)} className="text-lg sm:px-8">
            No, let me fix it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-16">
      <div className="flex flex-col">
        <h1 className={headingClass}>Fix your details</h1>
        <p className="mt-3 max-w-md text-lg text-muted">Change anything that&apos;s wrong, or add what we missed.</p>

        <div className="mt-8 flex flex-col gap-9">
          <div className="flex flex-col gap-2">
            <label htmlFor={FIELD.name} className="text-xl font-bold leading-snug tracking-tight">
              Name
            </label>
            <input
              ref={nameRef}
              id={FIELD.name}
              type="text"
              value={d.name}
              maxLength={LIMITS.name + 20}
              autoComplete="name"
              aria-invalid={nameIssue ? true : undefined}
              aria-describedby={nameIssue ? "profile-name-problem" : undefined}
              onChange={(e) => update({ name: e.target.value })}
              className={`min-h-14 ${inputClass}`}
            />
            {nameIssue && (
              <p id="profile-name-problem" className={errorClass}>
                {nameIssue}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={FIELD.bio} className="text-xl font-bold leading-snug tracking-tight">
              Bio
            </label>
            <textarea
              id={FIELD.bio}
              rows={3}
              value={d.bio}
              maxLength={LIMITS.bio}
              placeholder="What you work on, in a sentence or two"
              aria-describedby="profile-bio-count"
              onChange={(e) => update({ bio: e.target.value })}
              className={`py-3 leading-snug ${inputClass}`}
            />
            <p id="profile-bio-count" className="self-end text-sm text-muted">
              {d.bio.length} of {LIMITS.bio}
            </p>
          </div>

          <ChipEditor
            id={FIELD.skills}
            legend="Can help with"
            hint="Add what people can ask you about."
            values={d.languages}
            onChange={(languages) => update({ languages })}
            text={pending.languages.text}
            onTextChange={(text) => setPending((p) => ({ ...p, languages: { ...p.languages, text } }))}
            problem={pending.languages.problem}
            onProblemChange={(problem) => setPending((p) => ({ ...p, languages: { ...p.languages, problem } }))}
            placeholder="e.g. Kubernetes"
            addLabel="Add a skill"
            empty="Nothing found yet. Add what you can help with."
          />

          <ChipEditor
            id={FIELD.orgs}
            legend="Part of"
            hint="Organisations and projects you belong to."
            values={d.organisations}
            onChange={(organisations) => update({ organisations })}
            text={pending.organisations.text}
            onTextChange={(text) => setPending((p) => ({ ...p, organisations: { ...p.organisations, text } }))}
            problem={pending.organisations.problem}
            onProblemChange={(problem) =>
              setPending((p) => ({ ...p, organisations: { ...p.organisations, problem } }))
            }
            placeholder="e.g. cncf"
            addLabel="Add an organisation"
            empty="None found. Add projects you belong to."
          />

          <div className="flex flex-col gap-2">
            <p className="text-xl font-bold leading-snug tracking-tight">Add more</p>
            <button
              type="button"
              disabled
              aria-describedby="upload-soon"
              className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-dashed border-border px-4 text-left font-semibold text-muted"
            >
              Upload a CV or LinkedIn export
              <span id="upload-soon" className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                Coming soon
              </span>
            </button>
          </div>
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
            {saving ? "Saving…" : "Save and finish"}
          </Button>
        </div>
      </div>

      {/* Laptop: the badge stays in view while you edit further down. */}
      <div className="hidden lg:block">
        <div className="lg:sticky lg:top-6">{badge}</div>
      </div>
    </form>
  );
}
