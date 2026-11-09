/**
 * The homepage badge's timing (hero-badge.tsx): quick at first, then slowing down onto the match.
 */
/**
 * How much slower than the first version every switch to the next person is (Aaron, 8 Nov:
 * "slowed down by 50%", read as half speed). Scales the gaps and each switch's own animation.
 */
export const HERO_PACE = 2;

/** Gaps between people, in ms: quick at first, then slowing down onto the match. */
export const HERO_STEPS = [80, 80, 80, 80, 80, 80, 80, 90, 105, 125, 150, 185, 230, 290, 370, 480, 640].map((gap) => gap * HERO_PACE);
