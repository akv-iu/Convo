import { ComingSoonButton } from "./coming-soon-button";

/** A booked meeting's time with Add to calendar (to the phone's calendar, later). */
export function MeetingBooked({ when, className = "mt-3" }: { when: string; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/10 px-4 py-3 ${className}`}>
      <p className="font-semibold">Meeting booked: {when}</p>
      <ComingSoonButton label={`Add the meeting on ${when} to your calendar`}>Add to calendar</ComingSoonButton>
    </div>
  );
}
