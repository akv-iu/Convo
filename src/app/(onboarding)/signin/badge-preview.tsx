/**
 * Step 1's badge: previews what each consent choice adds. It has no state
 * of its own: each optional row opens or closes with CSS `:has()` on the
 * surrounding form's checkboxes (group/consent), so it reacts instantly and
 * works without JavaScript.
 */
import { Badge, BadgeBar, BadgeChip } from "../_components/badge";

/** Opens when the named checkbox in the consent form is ticked. */
const row: Record<"profile" | "repos" | "orgs", string> = {
  profile: "group-has-[input[name=profile]:checked]/consent:grid-rows-[1fr] group-has-[input[name=profile]:checked]/consent:opacity-100",
  repos: "group-has-[input[name=repos]:checked]/consent:grid-rows-[1fr] group-has-[input[name=repos]:checked]/consent:opacity-100",
  orgs: "group-has-[input[name=orgs]:checked]/consent:grid-rows-[1fr] group-has-[input[name=orgs]:checked]/consent:opacity-100",
};

const closed =
  "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none";

export function BadgePreview() {
  return (
    <Badge>
      <div className={`${closed} ${row.profile}`}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-1.5 pt-4">
            <BadgeBar className="w-full" />
            <BadgeBar className="w-4/5" />
          </div>
        </div>
      </div>

      <div className={`${closed} ${row.repos}`}>
        <div className="overflow-hidden">
          <p className="pt-4 text-xs text-muted">Can help with</p>
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            <BadgeChip className="w-12 bg-accent/25" />
            <BadgeChip className="w-20 bg-accent/25" />
            <BadgeChip className="w-14 bg-accent/25" />
          </div>
        </div>
      </div>

      <div className={`${closed} ${row.orgs}`}>
        <div className="overflow-hidden">
          <p className="pt-4 text-xs text-muted">Part of</p>
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            <BadgeChip className="w-16" />
            <BadgeChip className="w-24" />
          </div>
        </div>
      </div>
    </Badge>
  );
}
