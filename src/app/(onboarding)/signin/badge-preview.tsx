/**
 * A conference badge that previews what each consent choice adds. It has
 * no state of its own: each optional row opens or closes with CSS `:has()`
 * on the surrounding form's checkboxes (group/consent), so it reacts
 * instantly and works without JavaScript. Decorative for screen readers;
 * the checkboxes carry the meaning.
 */

/** Opens when the named checkbox in the consent form is ticked. */
const row: Record<"profile" | "repos" | "orgs", string> = {
  profile: "group-has-[input[name=profile]:checked]/consent:grid-rows-[1fr] group-has-[input[name=profile]:checked]/consent:opacity-100",
  repos: "group-has-[input[name=repos]:checked]/consent:grid-rows-[1fr] group-has-[input[name=repos]:checked]/consent:opacity-100",
  orgs: "group-has-[input[name=orgs]:checked]/consent:grid-rows-[1fr] group-has-[input[name=orgs]:checked]/consent:opacity-100",
};

const closed =
  "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none";

function Bar({ className = "" }: { className?: string }) {
  return <span className={`block h-2.5 rounded-full bg-[var(--skeleton)] ${className}`} />;
}

function Chip({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-6 rounded-md bg-[var(--skeleton)] ${className}`} />;
}

export function BadgePreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[19rem] lg:mt-16">
      {/* lanyard */}
      <div className="absolute -top-16 left-1/2 hidden h-20 w-6 -translate-x-1/2 rounded-b-sm bg-accent lg:block" />
      <div className="absolute -top-2 left-1/2 hidden h-5 w-10 -translate-x-1/2 rounded-md border-4 border-foreground/70 lg:block" />

      <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[0_18px_40px_-18px_rgb(20_33_61/0.45)] ring-1 ring-border lg:rotate-[-2.5deg]">
        <div className="flex h-9 items-center justify-between bg-[var(--badge)] px-4 text-[13px] font-semibold text-[#14213d]">
          <span>Convo</span>
          <span className="font-normal">Salt Lake City</span>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="flex items-center gap-3">
            <span className="size-14 shrink-0 rounded-full bg-accent/80" />
            <div className="min-w-0 flex-1">
              <p className="text-2xl font-extrabold leading-tight tracking-tight [font-stretch:85%]">Your name</p>
              <p className="text-sm text-muted">@your-github</p>
            </div>
          </div>

          <div className={`${closed} ${row.profile}`}>
            <div className="overflow-hidden">
              <div className="flex flex-col gap-1.5 pt-4">
                <Bar className="w-full" />
                <Bar className="w-4/5" />
              </div>
            </div>
          </div>

          <div className={`${closed} ${row.repos}`}>
            <div className="overflow-hidden">
              <p className="pt-4 text-xs text-muted">Can help with</p>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                <Chip className="w-12 bg-accent/25" />
                <Chip className="w-20 bg-accent/25" />
                <Chip className="w-14 bg-accent/25" />
              </div>
            </div>
          </div>

          <div className={`${closed} ${row.orgs}`}>
            <div className="overflow-hidden">
              <p className="pt-4 text-xs text-muted">Part of</p>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                <Chip className="w-16" />
                <Chip className="w-24" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
