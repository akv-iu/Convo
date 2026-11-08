/**
 * A radar sweep for empty "waiting for people" states: rings, a turning beam, and dots that
 * light up as it passes, as if Lanyard is scanning the conference for you. Decorative only.
 * Without motion (prefers-reduced-motion) it shows the rings and dots, still.
 */
const DOTS = [
  { x: 68, y: 30, delay: "0.35s" },
  { x: 82, y: 66, delay: "1.1s" },
  { x: 36, y: 78, delay: "1.85s" },
  { x: 24, y: 40, delay: "2.6s" },
];

export function ScanRadar({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative aspect-square ${className}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full text-border">
        {[46, 32, 18].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ))}
        <path d="M50 4v92M4 50h92" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      </svg>
      {/* The beam: a wedge that fades behind its leading edge. */}
      <div className="absolute inset-[4%] rounded-full bg-[conic-gradient(from_0deg,var(--accent)_0deg,transparent_70deg,transparent_360deg)] opacity-40 motion-safe:animate-[scan-sweep_3s_linear_infinite]" />
      {DOTS.map((d) => (
        <span
          key={`${d.x}-${d.y}`}
          style={{ left: `${d.x}%`, top: `${d.y}%`, animationDelay: d.delay }}
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-2 opacity-60 motion-safe:animate-[scan-ping_3s_ease-out_infinite]"
        />
      ))}
      <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
    </div>
  );
}
