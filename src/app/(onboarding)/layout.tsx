import type { ReactNode } from "react";
import "@/components/ui/convo.css";
import { convoThemeClass } from "@/components/ui/theme";
import { BadgeColourSync } from "./_components/badge-colour-sync";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    // data-badge-pending keeps the badge stripe blank until BadgeColourSync applies the saved colour.
    <div className={`${convoThemeClass} flex flex-1 flex-col`} data-badge-pending="" suppressHydrationWarning>
      <BadgeColourSync />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6 pt-6 sm:px-8 sm:pt-12">{children}</main>
    </div>
  );
}
