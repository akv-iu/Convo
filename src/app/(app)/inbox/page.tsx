import type { Metadata } from "next";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Requests" };

/** A2 step 4: requests sent to you, question first, with accept, decline or a short reply. */
export default function InboxPage() {
  return <InboxView />;
}
