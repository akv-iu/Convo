"use client";

import { useState, type ReactNode } from "react";
import { HeroBadge } from "@/components/ui/hero-badge";
import { HeroStack, HeroSwap, HeroTwist } from "@/components/ui/hero-variants";

/** The homepage animation styles side by side, each with Replay, to choose between. */
export function HeroLab() {
  const [runs, setRuns] = useState([0, 0, 0, 0]);
  const replay = (i: number) => setRuns((r) => r.map((n, j) => (j === i ? n + 1 : n)));
  const styles: { title: string; note: string; render: (run: number) => ReactNode }[] = [
    { title: "A · Current (held)", note: "One badge, faces flick past", render: (run) => <HeroBadge key={run} /> },
    { title: "B · Stacked lanyards", note: "Badges drop onto a pile", render: (run) => <HeroStack run={run} /> },
    { title: "C · Rotating sideways", note: "The badge twists on its lanyard", render: (run) => <HeroTwist run={run} /> },
    { title: "D · Wearing the lanyard", note: "The person swaps; the badge dangles", render: (run) => <HeroSwap run={run} /> },
  ];
  return (
    <div className="grid gap-10 sm:grid-cols-2 xl:grid-cols-4">
      {styles.map((s, i) => (
        <section key={s.title} className="flex flex-col items-center gap-3">
          <h2 className="text-lg font-extrabold">{s.title}</h2>
          <p className="-mt-2 text-sm text-muted">{s.note}</p>
          <div className="flex min-h-[460px] w-full items-start justify-center">{s.render(runs[i])}</div>
          <button type="button" onClick={() => replay(i)} className="rounded-xl border-2 border-border px-4 py-2 font-semibold hover:border-accent">
            Replay
          </button>
        </section>
      ))}
    </div>
  );
}
