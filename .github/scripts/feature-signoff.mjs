// Feature sign-off, a required status. Most PRs pass at once, and their author merges them alone.
// A PR waits for an approval from someone other than its author only when
//   - it changes a feature file (docs/features/<feature>.md) whose checklist is now complete, unless
//     every file it changes is a screen file (screenOnly below), or
//   - it has the needs-approval label (Gitar adds it for the cases in .gitar/rules/needs-approval.md,
//     including what other users can see about a person, so screen PRs that change that still wait).
// Every run sets the same commit status on the PR's latest commit, so the newest verdict replaces the
// older ones and an approval turns it green in place. The verdict isn't the job's own result because
// GitHub keeps every failed run listed in red next to the newer green one.
// A local run sets the status too:
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=akv-iu/Convo PR_NUMBER=45 node .github/scripts/feature-signoff.mjs
import { pathToFileURL } from "node:url";

export const LABEL = "needs-approval";
export const CONTEXT = "Feature sign-off";
const FEATURE_FILE = /^docs\/features\/(?!TEMPLATE\.md$)[^/]+\.md$/;
/** Screen files: the pages people see, shared UI, their browser tests, static files and feature files. */
const SCREEN_FILE = /^(src\/app\/\((onboarding|app)\)\/|src\/app\/page\.tsx$|src\/components\/ui\/|tests\/e2e\/|public\/|docs\/features\/)/;

/** True when every changed file (old and new names) is a screen file, so completing a feature needs no sign-off. */
export function screenOnly(files) {
  const screen = (name) => SCREEN_FILE.test(name) && !name.split("/").includes(".."); // no climbing out of a screen folder
  return files.length > 0 && files.every((f) => screen(f.filename) && (!f.previous_filename || screen(f.previous_filename)));
}

/** Ticked and open checklist items ("- [x]" and "- [ ]") in a markdown file. */
export function checklist(markdown) {
  return {
    done: markdown.match(/^[ \t]*[-*] \[[xX]\](?=\s|$)/gm)?.length ?? 0,
    open: markdown.match(/^[ \t]*[-*] \[ \](?=\s|$)/gm)?.length ?? 0,
  };
}

const complete = (markdown) => {
  const { done, open } = checklist(markdown);
  return done > 0 && open === 0;
};

/** True when the PR ticks a feature's last box: complete now, and not already complete on the base branch. */
export function completes(head, base) {
  return complete(head) && !(base !== null && complete(base));
}

/**
 * Whether someone other than the author has approved, going by each person's latest verdict:
 * a later "request changes" or a dismissal cancels an approval, a plain comment doesn't. Bots don't count.
 */
export function approvedByOther(reviews, author) {
  const verdicts = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (!login || login === author || review.user.type === "Bot" || review.state === "COMMENTED") continue;
    verdicts.set(login, review.state);
  }
  return [...verdicts.values()].includes("APPROVED");
}

/** The status to set, from what needs sign-off and whether someone other than the author approved. */
export function verdict(reasons, approved) {
  if (!reasons.length) return { state: "success", description: "No sign-off needed: no feature file was completed outside screen files, and there is no needs-approval label." };
  const why = reasons.join("; ");
  return approved
    ? { state: "success", description: `Signed off by the other person (${why}).` }
    : { state: "failure", description: `Waiting for the other person's approval: ${why}.` };
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: number, RUN_URL: runUrl } = process.env;
  if (!number) return console.log("No PR_NUMBER: sign-off applies to pull requests only.");
  const call = async (path, { method = "GET", body, missingIsNull = false } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body && JSON.stringify(body),
    });
    if (missingIsNull && response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} ${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const text = async (path, ref) => {
    const file = await call(`/contents/${path}?ref=${ref}`, { missingIsNull: true });
    return file && Buffer.from(file.content, "base64").toString("utf8");
  };
  const all = async (path) => {
    const items = [];
    for (let page = 1; ; page++) {
      const batch = await call(`${path}?per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };

  const pr = await call(`/pulls/${number}`);
  const setStatus = ({ state, description }) =>
    call(`/statuses/${pr.head.sha}`, {
      method: "POST",
      // GitHub refuses descriptions over 140 characters; the full text is in the run's log.
      body: { context: CONTEXT, state, description: description.length > 140 ? `${description.slice(0, 139)}…` : description, target_url: runUrl },
    });
  // Pending first: if anything below fails, the PR stays blocked instead of keeping an older verdict.
  await setStatus({ state: "pending", description: "Checking whether this PR needs the other person's approval…" });

  const encode = (name) => name.split("/").map(encodeURIComponent).join("/");
  const files = await all(`/pulls/${number}/files`);
  // A screen-only PR completes its feature alone; only the needs-approval label can make it wait.
  const features = screenOnly(files) ? [] : files.filter((f) => f.status !== "removed" && FEATURE_FILE.test(f.filename));
  // Each feature file at the PR's head and on the base branch (by its old name if renamed), fetched at once.
  const completed = await Promise.all(features.map(async (f) => {
    const [head, base] = await Promise.all([text(encode(f.filename), pr.head.sha), text(encode(f.previous_filename ?? f.filename), pr.base.sha)]);
    return head !== null && completes(head, base) ? f.filename : null;
  }));
  const reasons = completed.filter(Boolean).map((name) => `this PR completes ${name}`);
  if (pr.labels.some((label) => label.name === LABEL)) reasons.push(`the ${LABEL} label`);

  const approved = reasons.length > 0 && approvedByOther(await all(`/pulls/${number}/reviews`), pr.user.login);
  const result = verdict(reasons, approved);
  console.log(`${CONTEXT}: ${result.state}. ${result.description}`);
  await setStatus(result);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
