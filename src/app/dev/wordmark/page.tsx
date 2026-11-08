import "@/components/ui/convo.css";
import { Wordmark } from "@/components/ui/logo";
import { convoThemeClass } from "@/components/ui/theme";

/** Dev-only: the two wordmark versions side by side, at the homepage's size and bigger. */
export default function WordmarkPage() {
  const heading = "font-extrabold leading-none tracking-[-0.03em] [font-stretch:85%]";
  return (
    <div className={`${convoThemeClass} flex min-h-screen flex-col gap-14 p-10`}>
      {(["tucked", "drop"] as const).map((variant) => (
        <section key={variant} className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted">{variant === "tucked" ? "A · Tucked (on the homepage now)" : "B · Dropped, curving left"}</h2>
          <p className={`${heading} text-8xl`}><Wordmark variant={variant} /></p>
          <p className={`${heading} text-[10rem]`}><Wordmark variant={variant} /></p>
        </section>
      ))}
    </div>
  );
}
