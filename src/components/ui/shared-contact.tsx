import type { SharedContact } from "@/contracts/types";

/** The other person's contact details on an agreed request, as links that open mail or the phone. */
export function SharedContactCard({ contact, name }: { contact: SharedContact; name: string }) {
  return (
    <div className="mt-3 rounded-xl border-2 border-accent-2 px-4 py-3">
      <p className="text-xs font-semibold text-muted">Contact {name}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {contact.email && (
          <li>
            <a href={`mailto:${contact.email}`} className="break-all font-semibold text-accent-2 underline underline-offset-4">
              {contact.email}
            </a>
          </li>
        )}
        {contact.phone && (
          <li>
            <a href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`} className="font-semibold text-accent-2 underline underline-offset-4">
              {contact.phone}
            </a>
          </li>
        )}
      </ul>
    </div>
  );
}
