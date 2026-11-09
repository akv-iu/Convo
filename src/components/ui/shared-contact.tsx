"use client";

import type { SharedContact } from "@/contracts/types";
import { fileName, saveFile, smallActionClass, vCard } from "./save-files";

/**
 * The other person's contact details on an agreed request: links that open mail or the phone,
 * Message (an email, or a text to their phone) and Save contact (a contact card for the phone).
 */
export function SharedContactCard({ contact, name, question }: { contact: SharedContact; name: string; question?: string }) {
  const subject = encodeURIComponent(question ? `Lanyard: ${question}` : "Meeting through Lanyard");
  const phone = contact.phone?.replace(/[^+0-9]/g, "");
  return (
    <div className="mt-3 rounded-xl border-2 border-accent-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">Contact {name}</p>
        <button
          type="button"
          onClick={() =>
            saveFile(
              `${fileName(name)}.vcf`,
              "text/vcard",
              vCard({ name, email: contact.email, phone: contact.phone, note: question ? `Met through Lanyard: ${question}` : "Met through Lanyard" }),
            )
          }
          className={smallActionClass}
        >
          Save contact<span className="sr-only"> for {name}</span>
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {contact.email && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <a href={`mailto:${contact.email}`} className="min-w-0 break-all font-semibold text-accent-2 underline underline-offset-4">
              {contact.email}
            </a>
            <a href={`mailto:${contact.email}?subject=${subject}`} className={smallActionClass}>
              Message<span className="sr-only"> {name} by email</span>
            </a>
          </li>
        )}
        {contact.phone && (
          <li className="flex flex-wrap items-center justify-between gap-2">
            <a href={`tel:${phone}`} className="font-semibold text-accent-2 underline underline-offset-4">
              {contact.phone}
            </a>
            <a href={`sms:${phone}`} className={smallActionClass}>
              Message<span className="sr-only"> {name} by text</span>
            </a>
          </li>
        )}
      </ul>
    </div>
  );
}
