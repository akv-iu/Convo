/**
 * A calendar waiting for a meeting, for the empty Meetings screen: its days light up one after
 * another as if looking for a free time, one day pulses as the slot still to be booked, and a
 * small clock ticks in the corner. Decorative only. Without motion (prefers-reduced-motion) it
 * shows the calendar, the open slot and the clock, still.
 */
const COLS = 5;
const ROWS = 3;
/** The open slot: middle row, fourth day. */
const SLOT = COLS + 3;

export function CalendarWait({ className = "" }: { className?: string }) {
  const days = Array.from({ length: COLS * ROWS }, (_, i) => i);
  return (
    <div aria-hidden="true" className={`relative aspect-square ${className}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
        {/* The calendar page and its header. */}
        <rect x="8" y="16" width="78" height="70" rx="9" className="fill-background stroke-border" strokeWidth="2.5" />
        <path d="M8 34h78" className="stroke-border" strokeWidth="2.5" />
        <rect x="8" y="16" width="78" height="18" rx="9" className="fill-accent opacity-15" />
        {/* Its two rings. */}
        <path d="M28 10v12M66 10v12" className="stroke-foreground" strokeWidth="3.5" strokeLinecap="round" />
        {days.map((i) => {
          const x = 15 + (i % COLS) * 13.4;
          const y = 41 + Math.floor(i / COLS) * 13.5;
          if (i === SLOT) {
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width="10"
                height="10"
                rx="2.5"
                className="fill-accent-2 [transform-box:fill-box] origin-center motion-safe:animate-[cal-slot_2.4s_ease-in-out_infinite]"
              />
            );
          }
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width="10"
              height="10"
              rx="2.5"
              style={{ animationDelay: `${i * 0.16}s` }}
              className="fill-border motion-safe:animate-[cal-day_2.4s_ease-in-out_infinite]"
            />
          );
        })}
        {/* The clock in the corner: its hand goes round while you wait. */}
        <circle cx="82" cy="80" r="14" className="fill-surface stroke-accent" strokeWidth="2.5" />
        <path d="M82 80v-6.5" className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" />
        <path
          d="M82 80v-9"
          className="stroke-foreground [transform-box:fill-box] origin-bottom motion-safe:animate-[cal-hand_4.8s_linear_infinite]"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="82" cy="80" r="2" className="fill-foreground" />
      </svg>
    </div>
  );
}
