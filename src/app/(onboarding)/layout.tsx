import { Bricolage_Grotesque } from "next/font/google";
import type { ReactNode } from "react";
import "./onboarding.css";

const onb = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-onb", display: "swap" });

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`onb ${onb.variable} flex flex-1 flex-col`}>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6 pt-6 sm:px-8 sm:pt-12">{children}</main>
    </div>
  );
}
