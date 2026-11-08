import { expect, it } from "vitest";
import { professionalCv, professionalText, sanitizeEvidence } from "./professional-text";

it("removes contact and sensitive lines without discarding professional research", () => {
  expect(professionalText("Email: ada@example.org\nPhone +1 (801) 555-1234\nDate of birth 1/2/1990\nReligion: private\n12 Main Street\nBuilds medical imaging software")).toBe("Builds medical imaging software");
});
it("takes CV evidence only from recognized professional sections, excluding references and personal sections", () => {
  const docs = professionalCv("owner", "Ada Example\nada@example.org\nExperience\nBuilt compilers\nSkills\nRust and LLVM\nReferences\nDr Other, other@example.org\nHobbies\nPrivate activities");
  expect(docs.map(d => d.excerpt)).toEqual(["Built compilers", "Rust and LLVM"]);
  expect(docs.every(d => d.kind === "cv" && !d.url && d.personId === "owner")).toBe(true);
  expect(professionalCv("owner", "A private unstructured document")).toEqual([]);
});
it("caps professional CV evidence at five bounded excerpts", () => {
  const docs = professionalCv("owner", Array.from({length:9},(_,i)=>`Projects\nProject ${i} ${"a".repeat(4000)}`).join("\n"));
  expect(docs).toHaveLength(5); expect(docs.every(d=>d.excerpt.length<=3000)).toBe(true);
  expect(new Set(docs.map(d=>d.id)).size).toBe(5);
});
it("sanitizes public excerpts too and drops empty evidence", () => {
  const doc = { id:"owner:paper:one",personId:"owner",sourceId:"owner:research",source:"research",kind:"paper",title:"A paper",excerpt:"Email ada@example.org\nCompiler design",url:"https://example.org",retrievedAt:new Date().toISOString() };
  expect(sanitizeEvidence([doc])[0].excerpt).toBe("Compiler design");
  expect(sanitizeEvidence([{...doc,excerpt:"Email ada@example.org"}])).toEqual([]);
});
it.each(["123 Main St", "123 Main St.", "42 Oak Rd.", "17 Pine Ave"])("removes ordinary abbreviated addresses: %s",address=>{
  expect(professionalText(address+"\nCompiler research")).toBe("Compiler research");
});
it("ends an allowed section at unrelated Markdown headings or professional references",()=>{
  expect(professionalCv("owner","## Skills\nTypeScript\n## Medical Information\nDiabetes").map(d=>d.excerpt)).toEqual(["TypeScript"]);
  expect(professionalCv("owner","Skills\nTypeScript\nProfessional References\nDr Other\nProfessor Friend").map(d=>d.excerpt)).toEqual(["TypeScript"]);
});
it.each(["Referees (available on request)", "References available upon request", "REFEREES - two academic", "Reference: on request"])("ends a section at a referees heading with trailing words: %s", heading => {
  expect(professionalCv("owner", `Skills\nTypeScript\n${heading}\nDr Jane Other, Professor of Physics`).map(d => d.excerpt)).toEqual(["TypeScript"]);
});
it("keeps professional lines that merely mention references", () => {
  expect(professionalCv("owner", "Projects\nReference implementation of a JSON parser").map(d => d.excerpt)).toEqual(["Reference implementation of a JSON parser"]);
});
