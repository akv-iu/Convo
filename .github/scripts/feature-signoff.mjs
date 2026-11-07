// Feature sign-off, a required check. Most PRs pass at once, and their author merges them alone.
// A PR waits for an approval from someone other than its author only when
//   - it changes a feature file (docs/features/<feature>.md) whose checklist is now complete, or
//   - it has the needs-approval label (Gitar adds it for the cases in .gitar/rules/needs-approval.md).
// The workflow runs again when a review is submitted or dismissed, so an approval turns it green.
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=akv-iu/Convo PR_NUMBER=45 node .github/scripts/feature-signoff.mjs
import { pathToFileURL } from "node:url";

export const LABEL = "needs-approval";
const FEATURE_FILE = /^docs\/features\/(?!TEMPLATE\.md$)[^/]+\.md$/;

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

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: number } = process.env;
  if (!number) return console.log("No PR_NUMBER: sign-off applies to pull requests only.");
  const get = async (path, { missingIsNull = false } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (missingIsNull && response.status === 404) return null;
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return response.json();
  };
  const text = async (path, ref) => {
    const file = await get(`/contents/${path}?ref=${ref}`, { missingIsNull: true });
    return file && Buffer.from(file.content, "base64").toString("utf8");
  };
  const all = async (path) => {
    const items = [];
    for (let page = 1; ; page++) {
      const batch = await get(`${path}?per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  };

  const pr = await get(`/pulls/${number}`);
  const encode = (name) => name.split("/").map(encodeURIComponent).join("/");
  const features = (await all(`/pulls/${number}/files`)).filter((f) => f.status !== "removed" && FEATURE_FILE.test(f.filename));
  // Each feature file at the PR's head and on the base branch (by its old name if renamed), fetched at once.
  const completed = await Promise.all(features.map(async (f) => {
    const [head, base] = await Promise.all([text(encode(f.filename), pr.head.sha), text(encode(f.previous_filename ?? f.filename), pr.base.sha)]);
    return head !== null && completes(head, base) ? f.filename : null;
  }));
  const reasons = completed.filter(Boolean).map((name) => `this PR completes ${name}`);
  if (pr.labels.some((label) => label.name === LABEL)) reasons.push(`the ${LABEL} label`);

  if (!reasons.length) return console.log("No sign-off needed: no feature file was completed and there is no needs-approval label.");
  if (approvedByOther(await all(`/pulls/${number}/reviews`), pr.user.login)) {
    return console.log(`Signed off by the other person (${reasons.join("; ")}).`);
  }
  console.log(`::error::Waiting for the other person's approval: ${reasons.join("; ")}.`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
