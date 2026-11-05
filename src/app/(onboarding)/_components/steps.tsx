const STEPS = ["Sign in", "About you", "Your profile", "Free time"] as const;

/** Progress through onboarding. `current` is 1-based. */
export function Steps({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="mb-8">
      <p className="mb-2 text-sm text-muted">
        Step {current} of {STEPS.length}
      </p>
      <ol className="flex gap-1.5" role="list">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const state = step < current ? "done" : step === current ? "current" : "todo";
          return (
            <li key={label} className="flex-1" aria-current={state === "current" ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={`block h-1.5 rounded-full ${state === "todo" ? "bg-border" : "bg-accent"}`}
              />
              <span className="sr-only">
                {label}
                {state === "done" ? ", done" : state === "current" ? ", current step" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
