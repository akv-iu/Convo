import type { ReactNode } from "react";
import { EraserIcon } from "@/components/ui/eraser-icon";
import type { ProfileVisibility } from "@/contracts/types";
import { BadgeChip } from "./badge";

/**
 * The lines of a badge a person can hide (country, workplace, hiring), shared by steps 2, 3
 * and 4 so the badge reads the same everywhere. A hidden line isn't there at all. With
 * `onHide`, each line ends in an eraser, right after its text, and tapping the line hides it.
 * The badge is decorative; the labelled switches beside it are how keyboard and screen-reader
 * users hide lines.
 */
type Section = keyof ProfileVisibility;

const HIDE_HINT = "Tap to hide from your badge";

/** The eraser at the end of a line: a small, solid chip, so it reads as "remove this text". */
function Eraser({ onStripe = false }: { onStripe?: boolean }) {
  return (
    <span
      className={`ml-1.5 inline-flex shrink-0 items-center justify-center rounded-md p-0.5 align-middle transition-colors motion-reduce:transition-none ${
        onStripe
          ? "bg-black/15 group-hover/line:bg-black/30"
          : "bg-foreground/15 group-hover/line:bg-[var(--danger)] group-hover/line:text-surface"
      }`}
    >
      <EraserIcon className="size-4" />
    </span>
  );
}

/** A tappable line: hovering strikes the text through, so it's clear the text goes. */
function Tappable({ section, onHide, className = "", children }: { section: Section; onHide: (s: Section) => void; className?: string; children: ReactNode }) {
  return (
    <span
      role="presentation"
      title={HIDE_HINT}
      onClick={() => onHide(section)}
      className={`group/line -mx-1 cursor-pointer rounded-md px-1 hover:bg-accent/10 [&_[data-line-text]]:decoration-2 hover:[&_[data-line-text]]:line-through ${className}`}
    >
      {children}
    </span>
  );
}

/** The country on the stripe, or a blank when hidden. */
export function BadgeCountry({ country, shown, onHide }: { country: string; shown: boolean; onHide?: (s: Section) => void }) {
  if (!shown) return " ";
  if (!onHide) return country;
  return (
    <Tappable section="country" onHide={onHide} className="inline-flex items-center">
      <span data-line-text="">{country}</span>
      <Eraser onStripe />
    </Tappable>
  );
}

/** Workplace and hiring, under the name. */
export function BadgeLines({
  workplace,
  hiring,
  visibility,
  onHide,
}: {
  workplace: string | null;
  hiring: boolean | null;
  visibility: ProfileVisibility;
  onHide?: (s: Section) => void;
}) {
  const workplaceLine = (
    <>
      <span className="block text-xs text-muted">Works at</span>
      <span className="block font-semibold leading-snug break-words">
        <span data-line-text="">{workplace}</span>
        {onHide && <Eraser />}
      </span>
    </>
  );
  const chip =
    hiring === null ? (
      <BadgeChip className="w-20" />
    ) : (
      <BadgeChip className={hiring ? "bg-accent text-on-accent" : "bg-[var(--skeleton)]"}>
        <span data-line-text="">{hiring ? "Hiring" : "Not hiring"}</span>
      </BadgeChip>
    );
  return (
    <>
      {visibility.workplace && workplace && (
        onHide ? (
          <Tappable section="workplace" onHide={onHide} className="mt-4 block">
            {workplaceLine}
          </Tappable>
        ) : (
          <span className="mt-4 block">{workplaceLine}</span>
        )
      )}
      {visibility.hiring && (
        onHide ? (
          <Tappable section="hiring" onHide={onHide} className="mt-3 flex w-fit items-center">
            {chip}
            <Eraser />
          </Tappable>
        ) : (
          <span className="mt-3 flex w-fit items-center">{chip}</span>
        )
      )}
    </>
  );
}
