# Quality gates: Sonar, Gitar and feature sign-off

Updated 7 November 2026. Phase 1, building the demo, is done. In phase 2 each of us ships features alone, screens and backend together, and waits for the other only when it matters. This page covers what each gate does, what changed, and how to ship a feature.

## In one minute

- Branch from `main`, open a PR, and wait for five checks. When they pass, merge it yourself or turn on auto-merge.
- A new feature starts with a feature file, `docs/features/<feature>.md`: a checklist of what it covers. Each PR ticks what it finished.
- The other person approves only when a feature is complete, or in five risky cases. Everything else merges without waiting.

## What changed for phase 2

| | Phase 1 (the demo) | Phase 2 (now) |
| --- | --- | --- |
| Who works where | A on screens, B on backend; editing the other's folders was flagged | Both work everywhere; the PR's author owns the whole change |
| Contract changes | Both people approved every one | Additive ones need no one; breaking ones need the other person |
| Merging | Person B merged Person A's PRs | Each person merges their own, or uses auto-merge |
| Waiting for the other person | Most PRs | A completed feature, and five risky cases |
| Gitar's rules | One of the five was folder ownership | It's replaced by "needs approval" |
| Required checks | Four | Five: `Feature sign-off` is added |
| Shared services | Person B applied migrations, rebuilt search and set Vercel variables | Either person applies migrations to Neon and rebuilds Elasticsearch; only Person B sets Vercel variables |

## How to ship a feature

1. Branch from `main` as `a/<feature>` or `b/<feature>`. Base every PR on `main`: Sonar's free plan doesn't scan PRs based on another branch.
2. In the first PR, copy [`docs/features/TEMPLATE.md`](features/TEMPLATE.md) to `docs/features/<feature>.md` and list what the feature covers. Delete template lines that don't apply.
3. Build it in as many PRs as you like. Each one ticks the items it finished.
4. Wait for the checks, fix or answer Gitar's findings, and merge.
5. The PR that ticks the last box waits. Ask the other person to try the feature on that PR's Vercel preview, following "How to try it", and approve. Their approval turns `Feature sign-off` green.

Bug fixes, refactors, tests and docs don't need a feature file.

## When the other person must approve

1. **A feature is complete:** the PR ticks the last box of its feature file.
2. **A breaking contract change:** a route or field removed or renamed, a field made required, or a status code or meaning changed. Adding an optional field or a route doesn't count.
3. **A migration that drops or rewrites data.** Adding columns, tables or indexes doesn't count.
4. **Sign-in, consent or privacy:** sessions, the GitHub token, source consent, or what other users can see about a person.
5. **A new environment variable in Person A's PR:** only Person B can set it in Vercel, and it must be set before the merge.
6. **The gates themselves:** `.github/`, `.gitar/`, `AGENTS.md`, `sonar-project.properties` and `vitest.config.mts`.

Gitar adds the `needs-approval` label in these cases, and `Feature sign-off` then waits for an approval from someone other than the author. For case 1 the check doesn't need the label: it counts the boxes itself, so it works even without Gitar. If Gitar labels a PR by mistake, ask the other person to approve it or remove the label; don't remove it yourself.

- An approval stays valid after later pushes. If you change something big after it, ask again.
- "Request changes" from the other person blocks the merge until they look again.

## What each gate does

### SonarQube Cloud

A rule-based inspector: same code in, same answer out.

- It scans every PR into `main` and every push to `main`.
- The gate ("Sonar way", new code only): at least 80% test coverage, at most 3% duplication, no new bugs, vulnerabilities or issues, and every security hotspot reviewed. Coverage and duplication count from 20 new lines. Screens are covered by Playwright instead of unit coverage.
- A failed gate fails `Lint, types, tests`, and the step *Why the quality gate failed* lists the files and lines.
- It doesn't know who wrote the code, so phase 2 leaves it as it is.

### Gitar

An AI reviewer that knows our rules.

- It reviews every PR against `AGENTS.md` and [`.gitar/review/`](../.gitar/review/), and labels its risk from [`.gitar/config/risk.md`](../.gitar/config/risk.md).
- Five rules in [`.gitar/rules/`](../.gitar/rules/) add a label and a checklist: contract change, migration, needs approval, new environment variable, and search rebuild.
- It pushes fixes when you comment `gitar auto-apply:on`, but never in the contract, migrations, sign-in, CI or its own rules, and never by weakening a test or a gate.
- **Its verdict is advice.** The `Gitar` check only means it finished reviewing, and its reviews are comments, which never block a merge. Fix or answer its findings before you merge; nothing else will make you.

### Feature sign-off

[`.github/workflows/feature-signoff.yml`](../.github/workflows/feature-signoff.yml) runs [`.github/scripts/feature-signoff.mjs`](../.github/scripts/feature-signoff.mjs).

- It passes at once for most PRs.
- It waits for an approval from someone other than the author when the PR completes a feature file or has the `needs-approval` label.
- It runs again whenever a review is submitted or dismissed.
- It shows up as a status named `Feature sign-off`, set by a job called `Evaluate sign-off`. Each run replaces the last verdict, so an approval turns the same entry green. The job itself goes red only if the script breaks; a run that breaks partway leaves the status pending, so the PR stays blocked until it runs again.

### Tests

Unchanged: lint, types and unit tests with coverage, then the Playwright click-through with an axe scan on the fake API.

## Your routine

- Wait for the checks, fix or answer Gitar, then merge or enable auto-merge.
- `main` went red after a merge? Whoever merged last fixes it first.
- Sonar failed? Read *Why the quality gate failed* in the CI run.
- Stuck on "waiting for Gitar" after a Gitar auto-fix? Gitar doesn't review its own commits. Review the fix, then push an empty commit (`git commit --allow-empty -m "Request Gitar review"`).
- Emergency: Person B is the repo admin and can merge anyway. Use it rarely and say why in the PR.

## Still to switch on

Person B, once this change is merged:

- [ ] GitHub settings: turn on "Allow auto-merge" and "Automatically delete head branches".
- [ ] Branch protection on `main`: add the `Feature sign-off` status to the required checks (not the `Evaluate sign-off` job). The `needs-approval` label already exists: Gitar created it.
- [ ] SonarQube Cloud: Administration → AI Code Assurance → "contains AI-generated code", then choose the AI-qualified gate. Check that today's code passes it first.

Each person:

- [ ] SonarQube for IDE in VS Code, connected to the `akv-iu_Convo` project, so Sonar's findings show while you edit.
- [ ] The SonarQube MCP server in Claude Code, so your agent checks Sonar's findings before pushing. The command is in [Sponsor-Tracks.md](Sponsor-Tracks.md).

## Deadline and open decision

- **Gitar's Pro trial ends about 20 November.** After that, every PR waits forever for the `Gitar` check, unless we move to Gitar's open-source plan, pay, or remove `Gitar` from the required checks. The open-source plan needs an open-source licence such as MIT, which also gets Sonar's open-source plan; both people must agree, because the code is ours. `Feature sign-off` doesn't depend on Gitar.
- The licence is undecided.

## The Sonar-track demo

One throwaway PR shows the gates at work: untested code is blocked. Add about 30 lines of logic with no test. The Sonar gate fails, and the report names the file. Comment `gitar auto-apply:on`, Gitar adds a test, and the checks turn green. Then close the PR without merging.

An earlier second probe asked whether Gitar's verdict blocks a merge. It doesn't; see "Its verdict is advice" above.

<details>
<summary>Exact commands (PowerShell)</summary>

```powershell
cd D:\Projects\Convo
git switch main; git pull
git switch -c b/probe-untested-code
$code = @'
// Probe for the quality gate: realistic logic with no test. Close the PR; never merge.
import type { Request } from "@/contracts/types";

export interface InboxSummary {
  waiting: number;
  accepted: number;
  declined: number;
  answered: number;
  scheduled: number;
  oldestWaitingMinutes: number | null;
}

export function summariseInbox(requests: Request[], now = new Date()): InboxSummary {
  const summary: InboxSummary = { waiting: 0, accepted: 0, declined: 0, answered: 0, scheduled: 0, oldestWaitingMinutes: null };
  for (const request of requests) {
    switch (request.status) {
      case "sent": {
        summary.waiting += 1;
        const minutes = Math.floor((now.getTime() - Date.parse(request.createdAt)) / 60_000);
        if (summary.oldestWaitingMinutes === null || minutes > summary.oldestWaitingMinutes) {
          summary.oldestWaitingMinutes = minutes;
        }
        break;
      }
      case "accepted":
        summary.accepted += 1;
        break;
      case "declined":
        summary.declined += 1;
        break;
      case "answered":
        summary.answered += 1;
        break;
      case "scheduled":
        summary.scheduled += 1;
        break;
    }
  }
  return summary;
}
'@
[IO.File]::WriteAllText("$PWD\src\server\requests\probe-gate.ts", $code)
git add src/server/requests/probe-gate.ts
git commit -m "Probe: untested inbox summary (do not merge)"
git push -u origin b/probe-untested-code
gh pr create --base main --title "Akshay Probe untested code (do not merge)" --body "Throwaway PR proving the gates block untested code. Close without merging."
```

Clean up:

```powershell
git switch main
gh pr close <probe-number> --delete-branch
```

</details>
