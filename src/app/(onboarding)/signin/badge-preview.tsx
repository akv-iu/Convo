/**
 * Step 1's badge: previews what each consent choice adds, in the chosen
 * colour. It has no state of its own. Everything reacts with CSS `:has()`
 * on the surrounding form (group/consent), so it is instant and works
 * without JavaScript:
 * - each optional row opens when its switch is on; when off, a small
 *   "+ Bio" stub stays so it can be brought back;
 * - each row is a <label> for its switch, so tapping the badge turns that
 *   source on or off, exactly like the switch;
 * - the stripe colour follows the colour picker (see the form's classes).
 */
import type { ReactNode } from "react";
import { Badge, BadgeBar, BadgeChip } from "../_components/badge";
import type { ConsentSource } from "../consent";

/** Classes keyed by the switch they follow. Written out in full so Tailwind generates them. */
const on: Record<ConsentSource, string> = {
  profile: "group-has-[#consent-profile:checked]/consent:grid-rows-[1fr] group-has-[#consent-profile:checked]/consent:opacity-100",
  repos: "group-has-[#consent-repos:checked]/consent:grid-rows-[1fr] group-has-[#consent-repos:checked]/consent:opacity-100",
  orgs: "group-has-[#consent-orgs:checked]/consent:grid-rows-[1fr] group-has-[#consent-orgs:checked]/consent:opacity-100",
};
const stubOff: Record<ConsentSource, string> = {
  profile: "group-has-[#consent-profile:checked]/consent:hidden",
  repos: "group-has-[#consent-repos:checked]/consent:hidden",
  orgs: "group-has-[#consent-orgs:checked]/consent:hidden",
};

const folding =
  "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none";

function Row({ source, stub, children }: { source: ConsentSource; stub: string; children: ReactNode }) {
  return (
    <label htmlFor={`consent-${source}`} className="group/row block cursor-pointer">
      <span className={`${folding} ${on[source]}`}>
        <span className="block overflow-hidden">
          <span className="-mx-2 block rounded-lg px-2 transition-colors group-hover/row:bg-accent/10 motion-reduce:transition-none">
            {children}
          </span>
        </span>
      </span>
      <span
        className={`mt-3 inline-flex h-7 items-center rounded-full border border-dashed border-border px-3 text-xs text-muted group-hover/row:border-accent group-hover/row:text-foreground ${stubOff[source]}`}
      >
        {stub}
      </span>
    </label>
  );
}

export function BadgePreview() {
  return (
    <Badge>
      <Row source="profile" stub="+ Bio">
        <span className="flex flex-col gap-1.5 pb-1 pt-4">
          <BadgeBar className="w-full" />
          <BadgeBar className="w-4/5" />
        </span>
      </Row>

      <Row source="repos" stub="+ Repos">
        <span className="block pb-1">
          <span className="block pt-4 text-xs text-muted">Can help with</span>
          <span className="flex flex-wrap gap-1.5 pt-1.5">
            <BadgeChip className="w-12 bg-accent/25" />
            <BadgeChip className="w-20 bg-accent/25" />
            <BadgeChip className="w-14 bg-accent/25" />
          </span>
        </span>
      </Row>

      <Row source="orgs" stub="+ Orgs">
        <span className="block pb-1">
          <span className="block pt-4 text-xs text-muted">Part of</span>
          <span className="flex flex-wrap gap-1.5 pt-1.5">
            <BadgeChip className="w-16" />
            <BadgeChip className="w-24" />
          </span>
        </span>
      </Row>
    </Badge>
  );
}
