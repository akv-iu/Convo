"use client";

import { useEffect, useState } from "react";
import { calendarEvent, fileName, saveFile, smallActionClass } from "./save-files";

/** "Starts in 25 min", "Starts in 2 h 10 min", "Happening now", "Ended", or nothing beyond a day. */
export function startsIn(start: string, end: string, now: number): string | null {
  const from = Date.parse(start) - now;
  if (Date.parse(end) <= now) return "Ended";
  if (from <= 0) return "Happening now";
  const minutes = Math.ceil(from / 60_000);
  if (minutes < 60) return `Starts in ${minutes} min`;
  if (minutes < 24 * 60) return `Starts in ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return null;
}

/** The current time, updated each minute (null until the screen is in the browser, so the server and browser agree). */
export function useMinuteClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

/**
 * A booked meeting's time, how soon it starts, and Add to calendar: a calendar file the phone
 * or laptop opens in its own calendar app.
 */
export function MeetingBooked({
  id,
  when,
  slot,
  withName,
  question,
  className = "mt-3",
}: {
  id: string;
  when: string;
  slot: { start: string; end: string };
  withName: string;
  question: string;
  className?: string;
}) {
  const now = useMinuteClock();
  const soon = now === null ? null : startsIn(slot.start, slot.end, now);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/10 px-4 py-3 ${className}`}>
      <p className="font-semibold">
        Meeting booked: {when}
        {soon && <span className="ml-2 whitespace-nowrap rounded-full bg-success px-2 py-0.5 text-xs font-bold text-on-success">{soon}</span>}
      </p>
      <button
        type="button"
        onClick={() =>
          saveFile(
            `Lanyard-${fileName(withName)}.ics`,
            "text/calendar",
            calendarEvent({ id, start: slot.start, end: slot.end, title: `Lanyard: meet ${withName}`, description: question }),
          )
        }
        className={smallActionClass}
      >
        Add to calendar<span className="sr-only"> (meeting with {withName})</span>
      </button>
    </div>
  );
}
