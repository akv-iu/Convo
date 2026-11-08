"use client";

/**
 * The homepage animations' shared timing: step through the attendees quickly, slow down, and
 * land on a randomly chosen match. With reduced motion it lands at once. `run` restarts it.
 */
import { useEffect, useState } from "react";
import { heroPeople } from "./hero-faces";

/**
 * How much slower than the first version every switch to the next person is (Aaron, 8 Nov:
 * "slowed down by 50%", read as half speed). Scales the gaps and each switch's own animation.
 */
export const HERO_PACE = 2;

/** Gaps between people, in ms: quick at first, then slowing down onto the match. */
export const HERO_STEPS = [80, 80, 80, 80, 80, 80, 80, 90, 105, 125, 150, 185, 230, 290, 370, 480, 640].map((gap) => gap * HERO_PACE);

export interface HeroSequence {
  /** The person showing now. */
  index: number;
  /** How many steps have happened (keys animations, so each step replays its entrance). */
  step: number;
  /** The gap before the step that's showing, so an animation can last as long as it does. */
  gap: number;
  /** True once it has landed on the match. */
  settled: boolean;
  /** The last few people shown, oldest first (the stacked style piles them up). */
  pile: { index: number; step: number }[];
}

export function useHeroSequence(run = 0, { steps = HERO_STEPS, startDelay = 450 } = {}): HeroSequence {
  const [state, setState] = useState<HeroSequence>({ index: 0, step: 0, gap: 0, settled: false, pile: [{ index: 0, step: 0 }] });

  useEffect(() => {
    const n = heroPeople.length;
    const match = Math.floor(Math.random() * n);
    const timers: number[] = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timers.push(window.setTimeout(() => setState({ index: match, step: 1, gap: 0, settled: true, pile: [{ index: match, step: 1 }] }), 0));
    } else {
      timers.push(window.setTimeout(() => setState((s) => ({ ...s, settled: false, pile: [{ index: s.index, step: s.step }] })), 0));
      let at = startDelay;
      steps.forEach((gap, i) => {
        at += gap;
        const step = i + 1;
        const index = (((match - steps.length + step) % n) + n) % n;
        timers.push(window.setTimeout(() => setState((s) => ({ index, step, gap, settled: false, pile: [...s.pile, { index, step }].slice(-4) })), at));
      });
      timers.push(window.setTimeout(() => setState((s) => ({ ...s, settled: true })), at + 120));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [run, steps, startDelay]);

  return state;
}
