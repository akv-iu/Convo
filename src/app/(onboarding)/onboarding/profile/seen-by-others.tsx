"use client";

/**
 * Step 4: "How people see you". The condensed row other people get in their
 * matches, built from the saved profile with the show/hide choices applied,
 * and the switches to change those choices before sending any requests.
 * Each switch saves at once (PUT /api/me { visibility }) and only flips once
 * the server confirms; a failure leaves it as it was, and it can be tried
 * again (repeating the save is safe).
 */
import { useState } from "react";
import { MatchSummary } from "@/components/ui/match-summary";
import type { Person, ProfileVisibility } from "@/contracts/types";
import { saveErrorMessage } from "../answers";
import { asSeenByOthers, SHOW_ALL } from "./edits";

const sections = [
  { id: "country", label: "Country" },
  { id: "workplace", label: "Workplace" },
  { id: "hiring", label: "Hiring status" },
] as const;

export function SeenByOthers({ person, onSaved }: { person: Person; onSaved: (p: Person) => void }) {
  const visibility = person.visibility ?? SHOW_ALL;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(next: ProfileVisibility) {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setFailure(saveErrorMessage(res.status, body));
      onSaved(body as Person);
    } catch {
      setFailure(saveErrorMessage(0, null));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="seen-heading" className="mt-10 border-t-2 border-border pt-8">
      <h2 id="seen-heading" className="text-2xl font-extrabold tracking-tight">
        How people see you
      </h2>
      <p className="mt-1 text-muted">This is your row in other people&apos;s matches. Choose what it shows.</p>

      <div className="mt-5 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <div className="rounded-2xl border-2 border-border bg-surface px-4 py-3" data-testid="seen-preview">
          <MatchSummary
            match={{
              person: asSeenByOthers(person, visibility),
              explanation: "Lanyard adds a line here on why you fit their question.",
              mutual: false,
            }}
          />
        </div>

        <fieldset className="border-0 p-0">
          <legend className="mb-2 text-base font-semibold">Show in your row</legend>
          <div className="flex flex-col gap-1.5">
            {sections.map((v) => (
              <label
                key={v.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 border-border bg-surface px-3 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
              >
                <span className="flex-1 font-semibold">{v.label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={visibility[v.id]}
                  aria-disabled={saving}
                  onChange={(e) => void save({ ...visibility, [v.id]: e.target.checked })}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="relative h-7 w-12 shrink-0 rounded-full bg-[var(--skeleton)] transition-colors peer-checked:bg-accent peer-aria-disabled:opacity-50 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-[left] peer-checked:after:left-6 motion-reduce:transition-none motion-reduce:after:transition-none"
                />
              </label>
            ))}
          </div>
          {failure && (
            <p role="alert" className="mt-2 text-sm font-medium text-[var(--danger)]">
              {failure}
            </p>
          )}
        </fieldset>
      </div>
    </section>
  );
}
