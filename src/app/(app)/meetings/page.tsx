import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { MeetingsView } from "./meetings-view";

export const metadata: Metadata = { title: "Meetings" };

/** Every booked meeting, yours and theirs, soonest first. */
export default function MeetingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <BackLink href="/inbox" label="Back to Requests" />
      <MeetingsView />
    </div>
  );
}
