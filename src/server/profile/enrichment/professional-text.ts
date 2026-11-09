import { EnrichmentEvidence } from "@/contracts/enrichment";
import type { ApprovedEvidence } from "../evidence";

const personal = /\b(?:date of birth|dob|marital status|nationality|citizenship|passport|social security|ssn|sexual orientation|religion|ethnicity|medical history)\b/i;
const contact = /^\s*(?:e-?mail|phone|tel(?:ephone)?|mobile|contact|address|gender|referees?|references)\b/i;
const email = /(?<![^\s@])[^\s@]+@\.*[^\s@.]+(?:\.+[^\s@.]+)+/; // dots and the rest never compete: linear time
const address = /\b\d+\s+[\p{L}\s]{1,60}\b(?:street|st|road|rd|avenue|ave|lane|drive|boulevard)\b\.?/iu;
/** A run of digits a phone number could be, once year ranges ("2019 - 2023") are set aside. */
const phone = (text: string) => /\+?\d[\d(). -]{6,}\d/.test(text.replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g, ""));

/** Conservative line filtering, not a guarantee against obfuscated personal information. */
export function professionalText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").split(/\r?\n/).map(s => s.trim()).filter(line =>
    !personal.test(line) && !contact.test(line) && !email.test(line) && !address.test(line) && !phone(line),
  ).join("\n").trim();
}

// For generated text, not CV lines: personal data, never topics. "Mobile robotics", "Contact tracing", "religion and
// technology" or "robots that drive" are professional; dropping a whole draft for them failed the import.
const personalData = /\b(?:date of birth|dob|marital status|passport|social security|ssn|sexual orientation)\b/i;
// House number, one to four capitalised words, then a capitalised street type ("12 Main Street", "4 Elm Ave").
const streetAddress = /\b\d{1,5}(?: [A-Z][\p{L}'-]*){1,4} (?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/u;

/** Contact or personal details in a generated bio or label (emails, phone numbers, street addresses, ID documents). */
export function hasPersonalDetails(text: string): boolean {
  return personalData.test(text) || email.test(text) || streetAddress.test(text) || phone(text);
}

export function sanitizeEvidence(input: unknown): ApprovedEvidence[] {
  return EnrichmentEvidence.array().max(36).parse(input).flatMap(doc => {
    const excerpt = professionalText(doc.excerpt).slice(0, 3000);
    return excerpt ? [{ ...doc, excerpt, title: professionalText(doc.title).slice(0, 300) || "Professional evidence" }] : [];
  });
}

/** Only recognized professional CV sections become candidate excerpts; the full CV is never evidence. */
export function professionalCv(owner: string, text: string): ApprovedEvidence[] {
  const sections: { label: string; lines: string[] }[] = [];
  let current: typeof sections[number] | undefined;
  for (const line of text.slice(0, 30_000).split(/\r?\n/)) {
    const heading = line.replace(/^\s*#+\s*/, "").trim().replace(/:$/, "");
    if (/^(?:(?:professional|work|research|teaching) )?experience$|^(?:education|skills|technical skills|publications|selected publications|projects|research interests|certifications|grants|awards)$/i.test(heading)) {
      current = { label: heading, lines: [] }; sections.push(current);
    } else if (/^\s*#+\s/.test(line) || /^(?:[\p{L} ]{1,60}):$/u.test(line.trim())
      || /^(?:(?:professional )?references|referees|personal(?: details| information)?|medical(?: information| history)?|hobbies|interests|contact)$/i.test(heading)
      // Referee headings often carry words after them ("Referees (available on request)"); never let the
      // names below them join the previous professional section. "Reference implementation" stays content.
      || /^(?:(?:professional )?references\b|referees?\b|reference\s*:)/i.test(heading)) current = undefined;
    else if (current) current.lines.push(line);
  }
  return sections.flatMap((section, index) => {
    const excerpt = professionalText(section.lines.join("\n")).slice(0, 3000);
    return excerpt ? [{ id: `${owner}:cv:excerpt-${index + 1}`, personId: owner, sourceId: `${owner}:cv`,
      source: "cv" as const, kind: "cv" as const, title: `CV: ${section.label}`, excerpt, retrievedAt: new Date().toISOString() }] : [];
  }).slice(0, 5);
}
