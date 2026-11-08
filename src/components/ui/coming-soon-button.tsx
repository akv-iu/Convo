"use client";

import { useState, type ReactNode } from "react";

/**
 * A button for something not built yet (Save contact, Message, Add to calendar). Pressing it says
 * "Coming soon" beside it, out loud for screen readers too, instead of doing nothing.
 */
export function ComingSoonButton({ children, label }: { children: ReactNode; label?: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label={label}
        onClick={() => setPressed(true)}
        className="inline-flex min-h-9 shrink-0 items-center rounded-lg border-2 border-accent-2 px-3 text-sm font-semibold text-accent-2 hover:bg-accent-2/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {children}
      </button>
      <span role="status" className="text-xs text-muted">
        {pressed ? "Coming soon" : ""}
      </span>
    </span>
  );
}
