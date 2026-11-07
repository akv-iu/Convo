import type { ReactNode } from "react";
import "@/components/ui/convo.css";
import { convoThemeClass } from "@/components/ui/theme";
import { BadgeColourSync } from "./_components/badge-colour-sync";
import { badgeColourScript } from "./_components/badge-prefs";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script sets --badge on this element before React hydrates.
    <div className={`${convoThemeClass} flex flex-1 flex-col`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: badgeColourScript() }} />
      <BadgeColourSync />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6 pt-6 sm:px-8 sm:pt-12">{children}</main>
    </div>
  );
}
