"use client";

import type { KeyboardEvent } from "react";
import { addChip, LIMITS, removeChip } from "./edits";

/**
 * A list of short values (skills, organisations) as removable chips plus
 * an input to add more. Removing a chip removes it from the profile when
 * saved; the button says so. The Add box's text and problem belong to the
 * form, so Save and finish can add what's still typed there (addPending).
 */
export function ChipEditor({
  id,
  legend,
  hint,
  values,
  onChange,
  placeholder,
  addLabel,
  empty,
  text,
  onTextChange,
  problem,
  onProblemChange,
}: {
  id: string;
  legend: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel: string;
  empty: string;
  text: string;
  onTextChange: (text: string) => void;
  problem: string | null;
  onProblemChange: (problem: string | null) => void;
}) {
  function add() {
    const result = addChip(values, text);
    onProblemChange(result.problem);
    if (result.list !== values) {
      onChange(result.list);
      onTextChange("");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // add the chip, don't submit the form
      add();
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 text-xl font-bold leading-snug tracking-tight">{legend}</legend>
      <p id={`${id}-hint`} className="-mt-1 text-sm text-muted">
        {hint}
      </p>

      {values.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={legend}>
          {values.map((v) => (
            <li
              key={v}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-border bg-surface pl-3.5 pr-1 font-medium"
            >
              <span className="break-all">{v}</span>
              <button
                type="button"
                onClick={() => onChange(removeChip(values, v))}
                aria-label={`Remove ${v} from your profile`}
                className="grid size-9 place-items-center rounded-full text-lg leading-none text-muted hover:bg-accent/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}

      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={text}
          maxLength={LIMITS.chip + 10}
          placeholder={placeholder}
          aria-label={addLabel}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(e) => {
            onTextChange(e.target.value);
            onProblemChange(null);
          }}
          onKeyDown={onKeyDown}
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-4 text-base placeholder:text-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-[var(--danger-border)]"
        />
        <button
          type="button"
          onClick={add}
          className="min-h-12 shrink-0 rounded-xl border-2 border-border px-4 font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Add
        </button>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="text-sm font-medium text-[var(--danger)]">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
