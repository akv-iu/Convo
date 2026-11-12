/**
 * Files Lanyard hands the user to keep: a contact card (.vcf) for the people they agree to meet,
 * and a calendar event (.ics) for each booked meeting. Phones open both in their own apps.
 */

/** Escapes text for vCard and iCalendar values (backslash, comma, semicolon, newline). */
const esc = (text: string) => text.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

export function vCard(contact: { name: string; email: string | null; phone: string | null; note?: string }): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(contact.name)}`,
    ...(contact.email ? [`EMAIL;TYPE=INTERNET:${contact.email}`] : []),
    ...(contact.phone ? [`TEL;TYPE=CELL:${contact.phone.replace(/[^+0-9]/g, "")}`] : []),
    ...(contact.note ? [`NOTE:${esc(contact.note)}`] : []),
    "END:VCARD",
    "",
  ].join("\r\n");
}

/** 20261109T093000Z */
const icsTime = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function calendarEvent(event: { id: string; start: string; end: string; title: string; description: string }): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lanyard//Meetings//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@lanyard`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(event.start)}`,
    `DTEND:${icsTime(event.end)}`,
    `SUMMARY:${esc(event.title)}`,
    `DESCRIPTION:${esc(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Hands the browser a file to save or open. */
export function saveFile(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A safe file name from a person's name: "Priya Natarajan" -> "Priya-Natarajan". */
export const fileName = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "lanyard";

/** The small outlined buttons and links beside contact details and meeting times. */
export const smallActionClass =
  "inline-flex min-h-9 shrink-0 items-center rounded-lg border-2 border-accent-2 px-3 text-sm font-semibold text-accent-2 hover:bg-accent-2/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
