import type { ReactNode } from "react";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10 sm:py-16">{children}</main>;
}
