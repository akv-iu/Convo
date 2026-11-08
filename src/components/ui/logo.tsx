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
        <svg
          viewBox="0 0 60 100"
          focusable="false"
          className="mx-[0.01em] inline-block h-[0.98em] w-[0.6em] align-[-0.4em]"
        >
          {/* The strap: the y's two arms, meeting at the clip. */}
          <path d="M8 6 30 45 52 6" fill="none" stroke="currentColor" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="22" y="40" width="16" height="11" rx="3" fill="currentColor" />
          {/* The badge: the y's tail. */}
          <rect x="11" y="49" width="38" height="48" rx="7" fill="var(--accent)" />
          <path d="M11 56a7 7 0 0 1 7-7h24a7 7 0 0 1 7 7v4H11z" fill="var(--logo-stripe)" />
          <circle cx="23" cy="76" r="6" fill="var(--on-accent)" />
          <rect x="33" y="71" width="11" height="4" rx="2" fill="var(--on-accent)" />
          <rect x="33" y="79" width="8" height="4" rx="2" fill="var(--on-accent)" />
        </svg>
        ard
      </span>
    </span>
  );
}
