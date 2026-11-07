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
        <LogoMark className="size-14" />
        <h1 className="text-[3rem] font-extrabold leading-none tracking-[-0.03em] [font-stretch:85%] sm:text-7xl">
          Lanyard
        </h1>
        <p className="text-xl text-muted">
          Ask one question. Meet the few people at the conference who can actually answer it.
        </p>
        <div>
          <Button href="/signin" className="text-lg sm:px-8">
            Get started
          </Button>
        </div>
      </main>
    </div>
  );
}
