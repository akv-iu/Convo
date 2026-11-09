import { reasonHelp, type Reason } from "../../_components/reasons";

/**
 * A sanitized import result beside the source it affects: what happened,
 * then an expandable "How to fix this" (the brief's help table).
 */
export function HowToFix({ reason, retryAfterSeconds }: { reason: Reason; retryAfterSeconds?: number | null }) {
  const help = reasonHelp[reason];
  return (
    <div className="rounded-xl border-2 border-[var(--danger-border)] bg-surface px-4 py-3 text-sm">
      <p className="font-semibold">{help.title}</p>
      <details className="mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          How to fix this
        </summary>
        <p className="mt-1">{help.fix}</p>
        {retryAfterSeconds ? <p className="mt-1 text-muted">You can try again in about {retryAfterSeconds} seconds.</p> : null}
      </details>
    </div>
  );
}
