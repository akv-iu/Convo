import { Button } from "@/components/ui/button";
import "@/components/ui/convo.css";
import { LogoMark } from "@/components/ui/logo";
import { convoThemeClass } from "@/components/ui/theme";

/**
 * The front door. Developer notes (the API contract and fake-mode details)
 * live at /dev/routes, not here.
 */
export default function Home() {
  return (
    <div className={`${convoThemeClass} flex flex-1 flex-col`}>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
        {/* The lanyard beside the name, the name sized to match it. */}
        <div className="flex items-center gap-3 sm:gap-4">
          <LogoMark className="size-14 shrink-0 sm:size-16" />
          <h1 className="text-[2.75rem] font-extrabold leading-none tracking-[-0.03em] [font-stretch:85%] sm:text-6xl">
            Lanyard
          </h1>
        </div>
        <p className="text-xl text-muted">Ask questions about new technologies or jobs in order to meet the people who can help.</p>
        <div>
          <Button href="/signin" className="text-lg sm:px-8">
            Get started
          </Button>
        </div>
      </main>
    </div>
  );
}
