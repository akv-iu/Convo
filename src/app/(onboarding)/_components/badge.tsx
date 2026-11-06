import type { CSSProperties, ReactNode } from "react";

/**
 * The conference badge that runs through onboarding: lanyard (laptop only),
 * coloured stripe, avatar and name, then whatever rows the current step adds.
 * The stripe uses --badge, so a colour can come from a prop or from CSS on a
 * surrounding element (step 1's picker). Decorative for screen readers; each
 * screen's form carries the meaning.
 */
export function Badge({
  children,
  label,
  colour,
  name = "Your name",
  handle = "your-github",
  nameFor,
}: {
  children?: ReactNode;
  label?: ReactNode;
  colour?: string;
  name?: string;
  handle?: string;
  /** When set, tapping the name focuses this input (the profile card's name field). */
  nameFor?: string;
}) {
  const style = colour ? ({ "--badge": colour } as CSSProperties) : undefined;
  return (
    <div aria-hidden="true" style={style} className="relative mx-auto w-full max-w-[19rem] lg:mt-16">
      <div className="absolute -top-16 left-1/2 hidden h-20 w-6 -translate-x-1/2 rounded-b-sm bg-accent lg:block" />
      <div className="absolute -top-2 left-1/2 hidden h-5 w-10 -translate-x-1/2 rounded-md border-4 border-foreground/70 lg:block" />

      <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[0_18px_40px_-18px_rgb(20_33_61/0.45)] ring-1 ring-border lg:rotate-[-2.5deg]">
        <div
          data-badge-stripe
          className="flex h-9 items-center justify-between bg-[var(--badge)] px-4 text-[13px] font-semibold text-[#14213d] transition-colors duration-200 motion-reduce:transition-none"
        >
          <span>Convo</span>
          <span className="font-normal">{label ?? "Salt Lake City"}</span>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="flex items-center gap-3">
            <span className="size-14 shrink-0 rounded-full bg-accent/80" />
            <div className="min-w-0 flex-1">
              {nameFor ? (
                <label
                  htmlFor={nameFor}
                  className="-mx-1 block cursor-pointer rounded-md px-1 text-2xl font-extrabold leading-tight tracking-tight break-words [font-stretch:85%] hover:bg-accent/10"
                >
                  {name}
                </label>
              ) : (
                <p className="text-2xl font-extrabold leading-tight tracking-tight break-words [font-stretch:85%]">{name}</p>
              )}
              <p className="truncate text-sm text-muted">@{handle}</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function BadgeBar({ className = "" }: { className?: string }) {
  return <span className={`block h-2.5 rounded-full bg-[var(--skeleton)] ${className}`} />;
}

export function BadgeChip({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md bg-[var(--skeleton)] px-2 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}
