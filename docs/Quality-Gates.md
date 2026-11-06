# Quality gates: Sonar and Gitar

Updated 6 November 2026. What we set up, why, how to use it, and what to switch on when new keys or plans arrive.

## In one minute

Nothing reaches `main` without a pull request, and a pull request merges only when four checks pass:

| Check | What it is |
| --- | --- |
| `Lint, types, tests` | Our tests, then the SonarQube Cloud scan |
| `Click-through (fake API)` | Playwright clicks through the screens, with an accessibility scan |
| `SonarCloud Code Analysis` | Sonar's verdict (the quality gate) |
| `Gitar` | The AI reviewer has finished its review |

- **SonarQube Cloud** is a rule-based inspector: same code in, same answer out. It catches bugs, security holes, copy-paste and untested code.
- **Gitar** is an AI reviewer that knows *our* rules: who owns which folder, the API contract, privacy. It reviews, labels and can push fixes.

They catch different things, so we use both.

## What we set up, and why

| What | Why it helps us |
| --- | --- |
| **Branch protection on `main`** | A broken change can't land by accident. No approval count is required, so each of us can still merge our own PRs. |
| **Sonar quality gate** ("Sonar way", the free default) | New code needs 80% test coverage, at most 3% duplication, no new bugs or vulnerabilities, and every security hotspot reviewed. Coverage and duplication only count from 20 new lines. |
| **Our test coverage feeds Sonar** | Coverage is measured, not guessed (about 95% today). Screens are left out because Playwright tests them. |
| **A failed gate fails CI, with a report** | The CI step *Why the quality gate failed* lists the exact files and lines, so you or Gitar know what to fix without opening the Sonar site. |
| **Gitar review rules** (`.gitar/review/`) | Gitar checks Convo's own rules, not generic advice: contract changes, folder ownership, ownership checks in database queries, hidden profile fields staying hidden, batched and cached AI calls, keyboard access, no live services in tests. |
| **Five Gitar rules** (`.gitar/rules/`) | Automatic labels and checklists for five risky moments: a contract change, a new migration, a PR in the other person's folders, a search mapping change, a new environment variable. |
| **A risk label on every PR** (`.gitar/config/risk.md`) | High, Medium or Low, based on Convo's danger zones. It tells you which PRs deserve a careful read. |
| **Auto-apply, with limits** (`.gitar/config/apply.md`) | Gitar may push small fixes, but never in the contract, migrations, sign-in, CI or its own rules. |
| **"Keep the gates honest"** (`.gitar/instructions/`) | Gitar may never make CI pass by deleting a test, lowering a threshold or silencing a warning. |
| **Public repo, badges in the README** | Free Sonar with no size limit, branch protection on a free GitHub account, and judges see the gate status at a glance. |

### Three scenarios

**1. An agent adds code without tests.** CI goes red. *Why the quality gate failed* says something like `src/server/x.ts: 18 of 18 new lines not run by any test`, and Gitar marks it blocking. Fix: add the tests, or comment `gitar auto-apply:on` and let Gitar write them. Sonar re-checks on the next push.

**2. Person A's agent edits a backend file.** Gitar adds the `cross-ownership` label, lists the files, and asks the folder's owner to approve the change or move it into their own PR.

**3. A PR starts using a new key, such as `OPENAI_API_KEY`.** Gitar adds `env-change` and a checklist: add the key to `.env.example` with an empty value, and set it in Vercel *before* merging. Otherwise production breaks the moment the PR merges.

## Your routine

- Wait for the four green checks, then merge.
- Gitar flagged something? Fix it, or reply on its comment with the reason.
- Sonar failed? Open the CI run and read *Why the quality gate failed*.
- A stacked PR was retargeted to `main`? Push a commit so the Sonar check runs.
- Emergency: you are the repo admin, so GitHub lets you merge anyway. Use it rarely and say why in the PR.

## What to add next

Everything we can still add for the Sonar track (and for Elasticsearch and Dash0), with its value and effort, is in [Sponsor-Tracks.md](Sponsor-Tracks.md). That page also covers the SonarQube MCP server, the free open-source plans and where new keys go.

**One deadline:** Gitar's Pro trial ends about **20 November**. After that, Gitar stops reviewing and every PR gets stuck waiting for the `Gitar` check. The fixes are in the "Keys and trials" table on that page.

## Still to prove (and the Sonar-track demo)

Two throwaway PRs show the gates working, and the first one doubles as the demo for judges.

1. **Untested code is blocked.** Add about 30 lines of logic with no test. The Sonar gate fails, and the report names the file. Comment `gitar auto-apply:on`, Gitar adds a test, and the checks turn green.
2. **Gitar's verdict blocks a merge.** Add one optional field to `src/contracts/types.ts` without updating the fake. All checks pass, but Gitar labels the PR `contract-change` and requests changes. `gh pr view --json reviewDecision,mergeStateStatus` should show `CHANGES_REQUESTED` and `BLOCKED`. If it shows `CLEAN`, Gitar is only advisory under our settings, and we decide whether to require one approval.

<details>
<summary>Exact commands (PowerShell)</summary>

Probe 1, untested code:

```powershell
cd D:\Projects\Convo
git switch main; git pull
git switch -c b2/probe-untested-code
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
git push -u origin b2/probe-untested-code
gh pr create --base main --title "Akshay Probe untested code (do not merge)" --body "Throwaway PR proving the gates block untested code. Close without merging."
```

Probe 2, the contract rule:

```powershell
git switch main
git switch -c b2/probe-contract-rule
$path = "$PWD\src\contracts\types.ts"
$text = [IO.File]::ReadAllText($path) -replace '(  synthetic: z\.boolean\(\),)', "`$1`n  pronouns: z.string().max(40).optional(),"
[IO.File]::WriteAllText($path, $text)
git diff --stat   # expect: 1 file changed, 1 insertion
git commit -am "Probe: contract field without fake or test (do not merge)"
git push -u origin b2/probe-contract-rule
gh pr create --base main --title "Akshay Probe contract rule (do not merge)" --body "Throwaway PR proving Gitar's contract rule and merge block. Close without merging."
gh pr view --json reviewDecision,mergeStateStatus   # run once Gitar has commented
```

Clean up both:

```powershell
git switch main
gh pr close <probe-1-number> --delete-branch
gh pr close <probe-2-number> --delete-branch
```

</details>
