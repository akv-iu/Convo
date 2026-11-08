import type { Metadata } from "next";
import { BackLink } from "@/components/ui/back-link";
import { InboxView } from "./inbox-view";
import { SentRequests } from "./sent-requests";

export const metadata: Metadata = { title: "Requests" };

/** A2 steps 4 and 5: requests sent to you (answer them) and the ones you sent (see what happened). */
export default function InboxPage() {
  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col">
        <BackLink href="/ask" label="Back to Ask" />
      </div>
      <InboxView />
      <SentRequests />
    </>
  );
}
