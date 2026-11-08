import Link from "next/link";

/**
 * "← Back to …" at the top of a screen. It goes to the screen before this
 * one in Lanyard's flow (not the browser's history), so it works the same
 * after a reload or from a shared link, and never leaves Lanyard.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-2 mb-3 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
