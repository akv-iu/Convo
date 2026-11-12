/**
 * The pieces every signed-in page shares, so they read as one product: the title and subtitle
 * sizes, loading placeholders shaped like the cards that replace them, and empty states with the
 * same radar, heading, line and next step.
 */
import type { ReactNode } from "react";
import { ScanRadar } from "./scan-radar";

/** Every page's h1. */
export const pageTitleClass = "text-[2.2rem] font-extrabold leading-[1.02] tracking-[-0.03em] [font-stretch:85%] sm:text-5xl";
/** The line under a page's h1. */
export const pageSubtitleClass = "mt-3 text-lg text-muted";

/** Cards while a list loads: a picture circle and two lines, pulsing (still under reduced motion). */
export function CardSkeleton({ label, count = 2 }: { label: string; count?: number }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-start gap-3 rounded-2xl border-2 border-border bg-surface p-5">
          <span className="size-10 shrink-0 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3.5 w-2/5 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" />
            <span className="h-3 w-4/5 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" />
            <span className="h-3 w-3/5 rounded-full bg-[var(--skeleton)] motion-safe:animate-pulse" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Nothing here yet: the radar, a heading, one line on what will appear, and what to do next. */
export function EmptyState({
  title,
  children,
  action,
  headingLevel = 2,
  art,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
  /** The picture beside it; the radar (looking for people) unless the page has its own. */
  art?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-border bg-surface p-6 text-center sm:flex-row sm:gap-8 sm:text-left">
      {art ?? <ScanRadar className="w-28 shrink-0 sm:w-32" />}
      <div className="mt-5 sm:mt-0">
        <Heading className="text-2xl font-extrabold tracking-tight">{title}</Heading>
        <p className="mt-2 text-muted">{children}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
