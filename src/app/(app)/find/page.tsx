import type { Metadata } from "next";
import { FindView } from "./find-view";

export const metadata: Metadata = { title: "Find" };

/** The person finder: everyone at the event, filtered by a country, workplace, organisation or skill. */
export default function FindPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <FindView />
    </div>
  );
}
