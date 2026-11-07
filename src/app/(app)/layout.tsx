import Link from "next/link";
import type { ReactNode } from "react";
import "@/components/ui/convo.css";
import { Logo } from "@/components/ui/logo";
import { convoThemeClass } from "@/components/ui/theme";

/**
 * Shell for the signed-in screens (ask, matches, inbox): the same look as
 * onboarding, with a slim header. A skip link lets keyboard users jump
 * straight to the screen's content.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${convoThemeClass} flex flex-1 flex-col`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:outline-2 focus:outline-accent"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <nav aria-label="Main" className="mx-auto flex h-14 w-full max-w-5xl items-center gap-1 px-4 sm:px-8">
          <Link
            href="/ask"
            className="mr-auto rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Logo />
          </Link>
          <Link
            href="/ask"
            className="flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Ask
          </Link>
          <Link
            href="/inbox"
            className="flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Requests
          </Link>
          <Link
            href="/onboarding/profile"
            className="flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Profile
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6 sm:px-8 sm:pt-10">
        {children}
      </main>
    </div>
  );
}
