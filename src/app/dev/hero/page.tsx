import "@/components/ui/convo.css";
import { convoThemeClass } from "@/components/ui/theme";
import { HeroLab } from "./hero-lab";

/** A dev-only page to compare the homepage animation styles. */
export default function HeroStylesPage() {
  return (
    <div className={`${convoThemeClass} min-h-screen p-6`}>
      <h1 className="mb-6 text-3xl font-extrabold">Homepage animation styles</h1>
      <HeroLab />
    </div>
  );
}
