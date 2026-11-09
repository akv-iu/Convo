/**
 * The Lanyard logo: a conference badge hanging from its strap. The strap
 * is drawn in the current text colour, the badge in the accent with a
 * sunflower stripe, so it works on light and dark backgrounds.
 */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <path d="M7 1.5 16 12 25 1.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="13" y="10.5" width="6" height="4" rx="1" fill="currentColor" />
      <rect x="6" y="14" width="20" height="17" rx="3.5" fill="var(--accent)" />
      <path d="M6 17.5a3.5 3.5 0 0 1 3.5-3.5h13a3.5 3.5 0 0 1 3.5 3.5V19H6z" fill="var(--logo-stripe)" />
      <circle cx="12" cy="24.5" r="2.6" fill="var(--on-accent)" />
      <rect x="16.5" y="22.5" width="6.5" height="1.8" rx="0.9" fill="var(--on-accent)" />
      <rect x="16.5" y="25.6" width="4.5" height="1.8" rx="0.9" fill="var(--on-accent)" />
    </svg>
  );
}

/** Mark plus the name, for headers. The name is real text, so screen readers read "Lanyard". */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-xl font-extrabold tracking-tight [font-stretch:85%]">Lanyard</span>
    </span>
  );
}

/**
 * "Lanyard" with the logo as its y: a thicker strap makes the V of the letter's top half, and the
 * badge hangs below as its tail. Sized in em, so it follows the heading's font size. Screen
 * readers get the plain word.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">Lanyard</span>
      <span aria-hidden="true" className="whitespace-nowrap">
        Lan
        <LanyardY />
        ard
      </span>
    </span>
  );
}

/**
 * The y: the strap's V is the letter's top half, the strap carries on straight down from its point,
 * and the badge hangs centred below the line (yellow top, blue body). The V's point sits on the
 * baseline and its arms reach the tops of the other small letters.
 */
function LanyardY() {
  return (
    <svg viewBox="0 0 60 110" focusable="false" className="mx-[0.01em] inline-block h-[1.24em] w-[0.68em] align-[-0.65em]">
      <defs>
        {/* The strap's white turns into the badge's yellow where they meet. */}
        <linearGradient id="lanyard-y-strap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="currentColor" />
          <stop offset="1" stopColor="var(--logo-stripe)" />
        </linearGradient>
      </defs>
      {/* The V: the y's arms, meeting on the baseline. */}
      <path d="M9 11 30 52 51 11" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      {/* The strap's tail, straight down to the badge. */}
      <rect x="24.5" y="44" width="11" height="26" fill="url(#lanyard-y-strap)" />
      {/* The badge. */}
      <rect x="14" y="66" width="32" height="40" rx="7" fill="var(--accent)" />
      <path d="M14 73a7 7 0 0 1 7-7h18a7 7 0 0 1 7 7v8H14z" fill="var(--logo-stripe)" />
      <circle cx="23.5" cy="92" r="4.5" fill="var(--badge-ink)" />
      <rect x="31" y="90" width="9.5" height="4" rx="2" fill="var(--badge-ink)" />
    </svg>
  );
}
