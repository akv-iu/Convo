"use client";

/**
 * The homepage's badge: a conference badge on its lanyard (like the logo) that flicks through
 * attendees with different jobs and backgrounds, slows down, and settles on one as "Your match".
 * It plays once per visit. With reduced motion it shows the chosen person straight away, without
 * swaying. Decorative: the page's text says what Lanyard does.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { HeroFace, heroPeople } from "./hero-faces";
import { HERO_PACE, HERO_STEPS as STEPS } from "./hero-sequence";
/** A beat before it starts, so the page has painted. */
const START_DELAY = 450;

export function HeroBadge() {
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const n = heroPeople.length;
    const match = Math.floor(Math.random() * n);
    const timers: number[] = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timers.push(
        window.setTimeout(() => {
          setIndex(match);
          setSettled(true);
        }, 0),
      );
    } else {
      // Step through the faces so the last step lands on the match.
      let at = START_DELAY;
      STEPS.forEach((gap, i) => {
        at += gap;
        const step = i + 1;
        timers.push(window.setTimeout(() => setIndex((((match - STEPS.length + step) % n) + n) % n), at));
      });
      timers.push(window.setTimeout(() => setSettled(true), at + 120));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  const person = heroPeople[index];
  return (
    <div aria-hidden="true" data-hero-badge={settled ? "settled" : "spinning"} className="mx-auto w-52 select-none lg:w-60">
      <div
        className={`origin-top ${
          settled ? "motion-safe:animate-[hero-settle_1s_ease-out_1]" : "motion-safe:animate-[hero-sway_1.4s_ease-in-out_infinite]"
        }`}
      >
        {/* The strap and clip, as in the logo. */}
        <svg viewBox="0 0 160 84" className="mx-auto block h-16 w-32 text-foreground lg:h-[84px] lg:w-40">
          <path d="M16 2 80 70 144 2" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="66" y="64" width="28" height="18" rx="4" fill="currentColor" />
        </svg>
        <div
          className={`-mt-1 overflow-hidden rounded-3xl bg-surface shadow-[var(--popover-shadow)] ring-1 transition-shadow duration-500 ${
            settled ? "ring-4 ring-accent" : "ring-border"
          }`}
        >
          <div
            className="flex h-9 items-center justify-between px-4 text-[13px] font-semibold text-[var(--badge-ink)] transition-colors duration-150"
            style={{ backgroundColor: person.badge }}
          >
            <span>Lanyard</span>
            <span className="font-normal">Salt Lake City</span>
          </div>
          <div className="flex flex-col items-center px-5 pb-5 pt-4 text-center">
            <span key={index} className="block motion-safe:animate-[hero-tick_var(--tick)_ease-out]" style={{ "--tick": `${160 * HERO_PACE}ms` } as CSSProperties}>
              <HeroFace person={person} className="size-24 lg:size-28" />
            </span>
            <p className="mt-3 text-xl font-extrabold leading-tight tracking-tight [font-stretch:85%]">{person.name}</p>
            <p className="text-sm text-muted">{person.role}</p>
            <span
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-bold text-on-accent transition-all duration-300 ${
                settled ? "scale-100 opacity-100" : "scale-75 opacity-0"
              }`}
            >
              <span>✓</span> Your match
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
