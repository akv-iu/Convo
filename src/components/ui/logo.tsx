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
export function Wordmark({ className = "", variant = "tucked" }: { className?: string; variant?: "tucked" | "drop" }) {
  return (
    <span className={className}>
      <span className="sr-only">Lanyard</span>
      <span aria-hidden="true" className="whitespace-nowrap">
        Lan
        {variant === "drop" ? <DropY /> : <TuckedY />}
        ard
      </span>
    </span>
  );
}

/** The y with the badge tucked up under the strap's V, a little narrower than the arms. */
function TuckedY() {
  return (
    <svg viewBox="0 0 60 92" focusable="false" className="mx-[0.01em] inline-block h-[0.9em] w-[0.6em] align-[-0.32em]">
      {/* The strap: the y's two arms, meeting just above the badge. */}
      <path d="M8 6 30 43 52 6" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      {/* The badge: the y's tail. */}
      <rect x="15" y="40" width="30" height="47" rx="6" fill="var(--accent)" />
      <path d="M15 46a6 6 0 0 1 6-6h18a6 6 0 0 1 6 6v4H15z" fill="var(--logo-stripe)" />
      <circle cx="25" cy="66" r="5" fill="var(--on-accent)" />
      <rect x="33" y="62" width="8" height="3.6" rx="1.8" fill="var(--on-accent)" />
      <rect x="33" y="69" width="6" height="3.6" rx="1.8" fill="var(--on-accent)" />
    </svg>
  );
}

/**
 * The y as a written one: the V meets lower, the right arm carries on down and curves to the left
 * like a y's tail, and the badge hangs from its end, tilted with the curve, below the line.
 */
function DropY() {
  return (
    <svg viewBox="0 0 64 120" focusable="false" className="mx-[0.01em] inline-block h-[1.16em] w-[0.62em] align-[-0.56em]">
      {/* The left arm, meeting the right one below the baseline. */}
      <path d="M8 7 34 58" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
      {/* The right arm becomes the strap: down past the meeting point, then curving left. */}
      <path d="M56 7C50 30 42 50 34 62C29 70 24 74 18 77" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" />
      {/* The badge hangs from the strap's end, tilted with the curve. */}
      <g transform="rotate(16 18 78)">
        <rect x="5" y="74" width="27" height="40" rx="5.5" fill="var(--accent)" />
        <path d="M5 79.5a5.5 5.5 0 0 1 5.5-5.5h16a5.5 5.5 0 0 1 5.5 5.5v3.5H5z" fill="var(--logo-stripe)" />
        <circle cx="14" cy="97" r="4.5" fill="var(--on-accent)" />
        <rect x="21" y="93.5" width="7.5" height="3.2" rx="1.6" fill="var(--on-accent)" />
        <rect x="21" y="99.5" width="5.5" height="3.2" rx="1.6" fill="var(--on-accent)" />
      </g>
    </svg>
  );
}
