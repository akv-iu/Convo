const FLOWS = {
  classic: ["About you", "Your badge", "Free time", "Your details"],
  // Profile enrichment (PROFILE_ENRICHMENT_ENABLED): sign-in and source choices get their own page.
  enrichment: ["About you", "Sign in and sources", "Your badge", "Free time", "Your bio"],
} as const;

/** Progress through onboarding. `current` is 1-based. */
export function Steps({ current, flow = "classic" }: { current: number; flow?: keyof typeof FLOWS }) {
  const STEPS = FLOWS[flow];
  return (
    <nav aria-label="Onboarding progress" className="mb-6 flex items-center gap-3 sm:mb-10">
      <ol className="flex flex-1 gap-1.5 sm:max-w-56" role="list">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const state = step < current ? "done" : step === current ? "current" : "todo";
          return (
            <li key={label} className="flex-1" aria-current={state === "current" ? "step" : undefined}>
              <span
                aria-hidden="true"
                className={`block h-1 rounded-full ${state === "todo" ? "bg-border" : "bg-accent"}`}
              />
              <span className="sr-only">
                {label}
                {state === "done" ? ", done" : state === "current" ? ", current step" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted">
        Step {current} of {STEPS.length}
        <span aria-hidden="true">: {STEPS[current - 1]}</span>
      </p>
    </nav>
  );
}
