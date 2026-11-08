"use client";

/**
 * Other styles for the homepage animation, to compare at /dev/hero:
 * - HeroStack: badges drop onto a pile, each new one on top, until the match lands.
 * - HeroTwist: one badge twists on its lanyard, showing a new person with each turn.
 * - HeroSwap: a person wearing a lanyard (badge dangling on their chest) swaps for the next.
 * All slow down and settle on a match, and are decorative (aria-hidden).
 */
import type { CSSProperties } from "react";
import { HeroFace, heroPeople, HeroWearer, type HeroPerson } from "./hero-faces";
import { HERO_PACE, useHeroSequence } from "./hero-sequence";

function Strap({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 84" className={`mx-auto block h-[84px] w-40 text-foreground ${className}`}>
      <path d="M16 2 80 70 144 2" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="66" y="64" width="28" height="18" rx="4" fill="currentColor" />
    </svg>
  );
}

function Card({ person, matched = false }: { person: HeroPerson; matched?: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-3xl bg-surface shadow-[var(--popover-shadow)] ring-1 transition-shadow duration-500 ${
        matched ? "ring-4 ring-accent" : "ring-border"
      }`}
    >
      <div className="flex h-9 items-center justify-between px-4 text-[13px] font-semibold text-[var(--badge-ink)]" style={{ backgroundColor: person.badge }}>
        <span>Lanyard</span>
        <span className="font-normal">Salt Lake City</span>
      </div>
      <div className="flex flex-col items-center px-5 pb-5 pt-4 text-center">
        <HeroFace person={person} className="size-24" />
        <p className="mt-3 text-lg font-extrabold leading-tight tracking-tight [font-stretch:85%]">{person.name}</p>
        <p className="text-sm text-muted">{person.role}</p>
      </div>
    </div>
  );
}

function MatchChip({ show }: { show: boolean }) {
  return (
    <span
      className={`mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-bold text-on-accent transition-all duration-300 ${
        show ? "scale-100 opacity-100" : "scale-75 opacity-0"
      }`}
    >
      <span>✓</span> Your match
    </span>
  );
}

/** Badges pile up, each dropping in on top; the last one is the match. */
export function HeroStack({ run = 0 }: { run?: number }) {
  const { pile, settled } = useHeroSequence(run);
  return (
    <div aria-hidden="true" className="mx-auto w-60 select-none">
      <div className="relative mt-12 h-[330px]">
        {pile.map((card, i) => {
          const depth = pile.length - 1 - i; // 0 is the top of the pile
          const tilt = ((card.step * 37) % 11) - 5; // a little untidy, as a real pile would be
          const style: CSSProperties = {
            // Older badges sit higher and fanned out, so their edges show behind the newest.
            transform: `translate(${depth ? tilt * 5 : 0}px, ${-depth * 16}px) rotate(${depth ? tilt * 1.6 : 0}deg) scale(${1 - depth * 0.05})`,
            // Solid, never see-through: deeper badges are just a little darker.
            filter: depth ? `brightness(${1 - depth * 0.1})` : undefined,
            zIndex: 10 - depth,
          };
          return (
            <div key={card.step} className="absolute inset-x-0 top-0 transition-transform duration-300" style={style}>
              <div className="motion-safe:animate-[hero-drop_var(--drop)_ease-out]" style={{ "--drop": `${220 * HERO_PACE}ms` } as CSSProperties}>
                <Strap className="h-[60px] w-28" />
                <div className="-mt-1">
                  <Card person={heroPeople[card.index]} matched={settled && depth === 0} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <MatchChip show={settled} />
    </div>
  );
}

/** One badge twists on its lanyard, a new person each turn, and stops facing you. */
export function HeroTwist({ run = 0 }: { run?: number }) {
  const { index, step, gap, settled } = useHeroSequence(run);
  return (
    <div aria-hidden="true" className="mx-auto w-60 select-none">
      <Strap />
      <div className="-mt-1 [perspective:800px]">
        <div
          key={step}
          className="motion-safe:animate-[hero-twist_var(--twist)_ease-out_1] [transform-style:preserve-3d]"
          style={{ "--twist": `${Math.max(gap, 90 * HERO_PACE)}ms` } as CSSProperties}
        >
          <Card person={heroPeople[index]} matched={settled} />
        </div>
      </div>
      <MatchChip show={settled} />
    </div>
  );
}

/** A person wearing a lanyard, badge dangling on their chest, swapping for the next. */
export function HeroSwap({ run = 0 }: { run?: number }) {
  const { index, step, gap, settled } = useHeroSequence(run);
  const person = heroPeople[index];
  return (
    <div aria-hidden="true" className="mx-auto w-64 select-none">
      <div className={`relative overflow-hidden rounded-[2rem] transition-shadow duration-500 ${settled ? "ring-4 ring-accent" : ""}`} style={{ backgroundColor: person.badge }}>
        <div key={step} className="motion-safe:animate-[hero-swap_var(--swap)_ease-out_1]" style={{ "--swap": `${Math.min(Math.max(gap, 90 * HERO_PACE), 320 * HERO_PACE)}ms` } as CSSProperties}>
          <HeroWearer person={person} className="mx-auto block h-[300px] w-[200px]" />
        </div>
      </div>
      <p className="mt-3 text-center text-lg font-extrabold leading-tight tracking-tight [font-stretch:85%]">{person.name}</p>
      <p className="text-center text-sm text-muted">{person.role}</p>
      <MatchChip show={settled} />
    </div>
  );
}
