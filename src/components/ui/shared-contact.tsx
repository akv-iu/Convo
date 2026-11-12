import type { SharedContact } from "@/contracts/types";
import { ComingSoonButton } from "./coming-soon-button";

/** The other person's contact details on an agreed request: links that open mail or the phone, and quick actions. */
export function SharedContactCard({ contact, name }: { contact: SharedContact; name: string }) {
  return (
    <div className="mt-3 rounded-xl border-2 border-accent-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">Contact {name}</p>
        <ComingSoonButton label={`Save ${name}'s contact details`}>Save contact</ComingSoonButton>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {contact.email && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <a href={`mailto:${contact.email}`} className="min-w-0 break-all font-semibold text-accent-2 underline underline-offset-4">
              {contact.email}
            </a>
            <ComingSoonButton label={`Message ${name} by email`}>Message</ComingSoonButton>
          </li>
        )}
        {contact.phone && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <a href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`} className="font-semibold text-accent-2 underline underline-offset-4">
              {contact.phone}
            </a>
            <ComingSoonButton label={`Message ${name} by phone`}>Message</ComingSoonButton>
          </li>
        )}
      </ul>
    </div>
  );
}
