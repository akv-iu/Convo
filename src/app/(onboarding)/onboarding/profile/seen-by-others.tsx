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
import { Switch } from "@/components/ui/switch";
import type { Person, ProfileVisibility } from "@/contracts/types";
import { saveErrorMessage, SHOW_ALL, VISIBILITY_SECTIONS } from "../answers";
import { asSeenByOthers } from "./edits";

/**
 * Saving the show/hide choices at once (PUT /api/me { visibility }), shared by the switches
 * here and the erasers on step 4's badge, so both save, wait and fail the same way.
 */
export function useVisibilitySave(onSaved: (p: Person) => void) {
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

  return { save, saving, failure };
}

export function SeenByOthers({ person, saver }: { person: Person; saver: ReturnType<typeof useVisibilitySave> }) {
  const visibility = person.visibility ?? SHOW_ALL;
  const { save, saving, failure } = saver;

  return (
    <section aria-labelledby="seen-heading">
      <h2 id="seen-heading" className="text-2xl font-extrabold tracking-tight">
        How people see you
      </h2>
      <p className="mt-1 text-muted">This is your row in other people&apos;s matches. Choose what it shows.</p>

      {/* The public row, with what to hide straight under it. */}
      <div className="mt-4 flex flex-col gap-5">
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
            {VISIBILITY_SECTIONS.map((v) => (
              <Switch
                key={v.id}
                label={v.label}
                checked={visibility[v.id]}
                busy={saving}
                onChange={(on) => void save({ ...visibility, [v.id]: on })}
              />
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
