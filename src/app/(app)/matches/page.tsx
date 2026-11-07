import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchesView } from "./matches-view";

export const metadata: Metadata = { title: "Matches" };

/** A2 steps 1 and 2: the match list for /matches?ask=<askId>; tap a person to open their profile. */
export default function MatchesPage() {
  return (
    // The view reads ?ask= on the client; Suspense lets the rest of the page render first.
    <Suspense fallback={<p className="mx-auto max-w-xl">Finding people…</p>}>
      <MatchesView />
    </Suspense>
  );
}
