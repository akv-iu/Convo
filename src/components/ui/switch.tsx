import type { ReactNode } from "react";

/**
 * An on/off switch: a visually hidden checkbox with role="switch", and the whole row is the
 * label, so tapping anywhere on it toggles. `busy` marks it unavailable while a save runs
 * (aria-disabled, so it keeps keyboard focus); the caller ignores changes meanwhile.
 */
export function Switch({
  label,
  checked,
  onChange,
  busy = false,
  describedBy,
  aside,
  boxed = true,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy?: boolean;
  describedBy?: string;
  /** Shown between the label and the switch, e.g. "Shown" or "Hidden". Hidden from screen readers. */
  aside?: ReactNode;
  /** A bordered row (lists of switches) or a plain one inside its own box. */
  boxed?: boolean;
}) {
  return (
    <label
      className={
        boxed
          ? "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border-2 border-border bg-surface px-3 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          : "flex min-h-11 cursor-pointer items-center gap-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-accent"
      }
    >
      <span className="flex-1 font-semibold">{label}</span>
      {aside !== undefined && (
        <span className="text-sm text-muted" aria-hidden="true">
          {aside}
        </span>
      )}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-disabled={busy}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-full bg-[var(--skeleton)] transition-colors peer-checked:bg-accent peer-aria-disabled:opacity-50 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-[left] peer-checked:after:left-6 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
    </label>
  );
}
