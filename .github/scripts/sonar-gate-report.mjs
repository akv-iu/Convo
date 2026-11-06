// Explains a failed SonarQube Cloud quality gate in the CI log and the job summary:
// which conditions failed, the new issues and hotspots, and the files with untested
// or duplicated new lines. People read it there, and Gitar's CI-failure analysis
// gets concrete files and lines to fix instead of only a link.
//   PR_NUMBER=18 node .github/scripts/sonar-gate-report.mjs
import { appendFileSync } from "node:fs";

const API = "https://sonarcloud.io/api";
const PROJECT = "akv-iu_Convo";
const pr = process.env.PR_NUMBER;
if (!pr) {
  console.log("No PR_NUMBER; the report covers pull requests only.");
  process.exit(0);
}
const headers = process.env.SONAR_TOKEN ? { Authorization: `Bearer ${process.env.SONAR_TOKEN}` } : {};

async function get(path, params) {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, pullRequest: pr })}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

const file = (key) => key.replace(`${PROJECT}:`, "");
// New-code metrics arrive as `periods: [{ value }]` (sometimes `period` or a plain `value`).
const value = (measure) => Number(measure?.periods?.[0]?.value ?? measure?.period?.value ?? measure?.value ?? 0);

async function report() {
  const out = [];
  const { projectStatus } = await get("qualitygates/project_status", { projectKey: PROJECT });
  out.push(`## SonarQube Cloud quality gate: ${projectStatus.status}`, "");
  for (const c of projectStatus.conditions.filter((c) => c.status === "ERROR")) {
    const limit = c.comparator === "LT" ? "at least" : "at most";
    out.push(`- Failed: \`${c.metricKey}\` is ${c.actualValue}, needs ${limit} ${c.errorThreshold}`);
  }

  const { issues } = await get("issues/search", { componentKeys: PROJECT, issueStatuses: "OPEN,CONFIRMED", ps: "100" });
  if (issues.length) out.push("", "### New issues");
  for (const i of issues) out.push(`- ${file(i.component)}:${i.line ?? "-"} ${i.message} (${i.rule})`);

  const { hotspots } = await get("hotspots/search", { projectKey: PROJECT, status: "TO_REVIEW", ps: "100" });
  if (hotspots.length) out.push("", "### Security hotspots to review");
  for (const h of hotspots) out.push(`- ${file(h.component)}:${h.line ?? "-"} ${h.message} (${h.ruleKey})`);

  const { components } = await get("measures/component_tree", {
    component: PROJECT, qualifiers: "FIL", ps: "500",
    metricKeys: "new_lines_to_cover,new_uncovered_lines,new_duplicated_lines",
  });
  const metric = (c, key) => value(c.measures.find((m) => m.metric === key));
  const untested = components.filter((c) => metric(c, "new_uncovered_lines") > 0);
  if (untested.length) out.push("", "### New lines without test coverage");
  for (const c of untested) {
    out.push(`- ${file(c.key)}: ${metric(c, "new_uncovered_lines")} of ${metric(c, "new_lines_to_cover")} new lines not run by any test`);
  }
  const duplicated = components.filter((c) => metric(c, "new_duplicated_lines") > 0);
  if (duplicated.length) out.push("", "### New duplicated lines");
  for (const c of duplicated) out.push(`- ${file(c.key)}: ${metric(c, "new_duplicated_lines")} duplicated new lines`);

  out.push("", `Details: https://sonarcloud.io/dashboard?id=${PROJECT}&pullRequest=${pr}`);
  return out.join("\n");
}

try {
  const text = await report();
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
} catch (error) {
  // Diagnostic only: the scan step has already failed the job.
  console.log(`Could not build the quality gate report: ${error.message}`);
}
