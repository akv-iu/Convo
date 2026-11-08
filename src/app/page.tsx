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
      {/*
        Narrower screens: one centred column, with Get started straight under the badge, as the step
        after "Your match". Wide screens: the name and button on the left, the badge on the right.
      */}
      <main className="mx-auto grid w-full max-w-5xl flex-1 content-center items-center gap-6 px-4 py-6 text-center lg:py-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:text-left">
        <div className="flex flex-col items-center gap-5 lg:items-start lg:gap-6">
          {/* The name is the logo: its y is the badge on its strap. */}
          <h1 className="text-[3.5rem] font-extrabold leading-none tracking-[-0.03em] [font-stretch:85%] sm:text-7xl lg:text-8xl">
            <Wordmark />
          </h1>
          <p className="max-w-xl text-xl text-muted">
            Ask questions about new technologies or jobs in order to meet the people who can help.
          </p>
          <div className="hidden lg:block">
            <Button href="/signin" className="text-lg sm:px-8">
              Get started
            </Button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-5">
          {/* Attendees flick past on a badge and it settles on one: the person Lanyard finds for you. */}
          <HeroBadge />
          <div className="w-full max-w-xs lg:hidden">
            <Button href="/signin" className="w-full text-lg">
              Get started
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
