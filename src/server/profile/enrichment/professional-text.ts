import { EnrichmentEvidence } from "@/contracts/enrichment";
import type { ApprovedEvidence } from "../evidence";

const personal = /\b(?:date of birth|dob|marital status|nationality|citizenship|passport|social security|ssn|sexual orientation|religion|ethnicity|medical history)\b/i;
const contact = /^\s*(?:e-?mail|phone|tel(?:ephone)?|mobile|contact|address|gender|referees?|references)\b/i;
const email = /(?<![^\s@])[^\s@]+@\.*[^\s@.]+(?:\.+[^\s@.]+)+/; // dots and the rest never compete: linear time
const address = /\b\d+\s+[\p{L}\s]{1,60}\b(?:street|st|road|rd|avenue|ave|lane|drive|boulevard)\b\.?/iu;

/** Conservative line filtering, not a guarantee against obfuscated personal information. */
export function professionalText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").split(/\r?\n/).map(s => s.trim()).filter(line => {
    const withoutYears = line.replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/g, "");
    return !personal.test(line) && !contact.test(line) && !email.test(line) && !address.test(line)
      && !/\+?\d[\d(). -]{6,}\d/.test(withoutYears);
  }).join("\n").trim();
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
