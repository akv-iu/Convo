import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "@/components/ui/avatars";
import type { AvatarId } from "@/contracts/types";

/**
 * The conference badge that runs through onboarding: lanyard (laptop only),
 * coloured stripe, avatar and name, then whatever rows the current step adds.
 * The stripe uses --badge, so a colour can come from a prop or from CSS on a
 * surrounding element (step 1's picker). Decorative for screen readers; each
 * screen's form carries the meaning. The one exception is `avatarControl`
 * (step 2's "+" button on the picture), so the hiding is on the badge's parts,
 * not on the whole badge.
 */
export function Badge({
  children,
  label,
  colour,
  name = "Your name",
  handle = "your-github",
  avatar = null,
  avatarControl,
  onName,
}: {
  children?: ReactNode;
  label?: ReactNode;
  colour?: string;
  name?: string;
  /** Their GitHub handle; null when they have none (no handle line). Leave it out for the placeholder. */
  handle?: string | null;
  /** The chosen picture; null shows initials. */
  avatar?: AvatarId | null;
  /** An interactive control on the picture (step 2's "+"), left visible to screen readers. */
  avatarControl?: ReactNode;
  /**
   * When set, tapping the name calls this (the profile card opens its name
   * field). A click handler, not a <label>: the badge is aria-hidden, and a
   * label would add the badge's text to the field's accessible name.
   */
  onName?: () => void;
}) {
  const style = colour ? ({ "--badge": colour } as CSSProperties) : undefined;
  return (
    <div data-badge="" style={style} className="relative mx-auto w-full max-w-[19rem] lg:mt-16">
      <div aria-hidden="true" className="absolute -top-16 left-1/2 hidden h-20 w-6 -translate-x-1/2 rounded-b-sm bg-accent lg:block" />
      <div aria-hidden="true" className="absolute -top-2 left-1/2 hidden h-5 w-10 -translate-x-1/2 rounded-md border-4 border-foreground/70 lg:block" />

      <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[var(--popover-shadow)] ring-1 ring-border lg:rotate-[-2.5deg]">
        <div
          aria-hidden="true"
          data-badge-stripe
          className="flex h-9 items-center justify-between bg-[var(--badge)] px-4 text-[13px] font-semibold text-[var(--badge-ink)] transition-colors duration-200 motion-reduce:transition-none"
        >
          <span>Lanyard</span>
          <span className="font-normal">{label ?? "Salt Lake City"}</span>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <Avatar avatar={avatar} name={name} className="size-14 text-xl" />
              {avatarControl}
            </div>
            <div aria-hidden="true" className="min-w-0 flex-1">
              {onName ? (
                <span
                  role="presentation"
                  onClick={onName}
                  className="-mx-1 block cursor-pointer rounded-md px-1 text-2xl font-extrabold leading-tight tracking-tight break-words [font-stretch:85%] hover:bg-accent/10"
                >
                  {name}
                </span>
              ) : (
                <p className="text-2xl font-extrabold leading-tight tracking-tight break-words [font-stretch:85%]">{name}</p>
              )}
              {handle && <p className="truncate text-sm text-muted">@{handle}</p>}
            </div>
          </div>
          {children !== undefined && <div aria-hidden="true">{children}</div>}
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
