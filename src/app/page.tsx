import { Button } from "@/components/ui/button";
import "@/components/ui/convo.css";
import { HeroBadge } from "@/components/ui/hero-badge";
import { Wordmark } from "@/components/ui/logo";
import { convoThemeClass } from "@/components/ui/theme";

/**
 * The front door. Developer notes (the API contract and fake-mode details)
 * live at /dev/routes, not here.
 */
export default function Home() {
  return (
    <div className={`${convoThemeClass} flex flex-1 flex-col`}>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
        <div className="flex flex-col gap-6">
          {/* The name is the logo: its y is the badge on its strap. */}
          <h1 className="text-[3.5rem] font-extrabold leading-none tracking-[-0.03em] [font-stretch:85%] sm:text-8xl">
            <Wordmark />
          </h1>
          <p className="max-w-xl text-xl text-muted">
            Ask one question. Meet the few people at the conference who can actually answer it.
          </p>
          <div>
            <Button href="/signin" className="text-lg sm:px-8">
              Get started
            </Button>
          </div>
        </div>
        {/* Attendees flick past on a badge and it settles on one: the person Lanyard finds for you. */}
        <HeroBadge />
      </main>
    </div>
  );
}
