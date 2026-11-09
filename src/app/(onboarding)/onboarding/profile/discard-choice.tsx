"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Write my own bio instead", asked twice: discarding cancels the import and
 * erases what was read for it, which can't be undone.
 */
export function DiscardChoice({ onDiscard, busy }: { onDiscard: () => void; busy: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="secondary" onClick={() => setAsking(true)} className="self-start">
        Write my own bio instead
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-border bg-surface px-4 py-3">
      <p>This discards the draft and everything read for it. You can then write your bio yourself.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onDiscard} disabled={busy}>
          {busy ? "Discarding…" : "Discard the draft"}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)} disabled={busy}>
          Keep reviewing
        </Button>
      </div>
    </div>
  );
}
