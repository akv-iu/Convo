/**
 * One symbol per request status, so "where it stands" reads at a glance: a clock while waiting,
 * a tick when accepted, a cross when declined, a speech bubble for a reply and a calendar for a
 * booked meeting. Decorative: the status is always written next to it.
 */
import type { RequestStatus } from "@/contracts/types";

const COLOUR: Record<RequestStatus, string> = {
  sent: "text-muted",
  accepted: "text-success",
  declined: "text-[var(--danger)]",
  answered: "text-accent-2",
  scheduled: "text-success",
};

const PATHS: Record<RequestStatus, string[]> = {
  // A clock: still waiting.
  sent: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  // A tick in a circle.
  accepted: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m8 12.5 2.8 2.7L16 9.5"],
  // A cross in a circle.
  declined: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m9 9 6 6M15 9l-6 6"],
  // A speech bubble.
  answered: ["M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z", "M8 9.5h8M8 12.5h5"],
  // A calendar with a tick.
  scheduled: ["M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z", "M4 10h16M8 4v4M16 4v4", "m9 15 2 2 4-4"],
};

export function StatusIcon({ status, className = "size-4" }: { status: RequestStatus; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-status-icon={status}
      className={`inline-block shrink-0 ${COLOUR[status]} ${className}`}
    >
      {PATHS[status].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
