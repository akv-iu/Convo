# Sponsor tracks: what we use, and what to add

Updated 6 November 2026. Researched ahead of time, so the hackathon day is for building, not reading docs.
⭐ marks the best value for the judges per hour. Effort: **S** is under 30 minutes, **M** is 1 to 2 hours.

## What the judges look for

From the hackathon site, in short:

| Track | Judges look for |
| --- | --- |
| **Elasticsearch** ("Find the Right Talk") | Elasticsearch as the core data layer, not a side feature; smart keyword, semantic, vector or hybrid search |
| **Sonar** ("Never Merge Broken") | Gitar as part of how we built, with features landing through PRs it reviewed; review instructions and rules that fit how we work; CI failure diagnosis and auto-apply fixing real problems |
| **Dash0** ("Stop Flying Blind") | Deep instrumentation: traces, logs, metrics, and real-user monitoring for the frontend; Agent0 or the MCP server finding and fixing something real on the day, shown in the demo; observability built into the product; a bonus for a dashboard or SLO |

Every track also scores how much easier the project makes conferences.

**Rules that affect us:**

- **Rule 1:** the main coding and design work must start after the hackathon begins. Get the organisers' OK in writing for our pre-built work (the Plan of Action's first task for A). If the answer is no, follow the Build-Plan's fallback.
- **Rule 5:** use of AI coding assistants must be disclosed. The README now says so.
- **Rule 4:** keep private data and keys out of the repo and off the screen during the demo.

## Elasticsearch

**Already planned (Phase 1):** hybrid search (keyword plus ELSER semantic, fused with RRF), one result per person (collapse), highlighted evidence, hard filters and exclusions, a boost for overlapping free time, and the percolator for "people looking for you" and mutual interest.

**Add** (all available on our Elastic Cloud trial):

| | Add | What it gives Convo | Effort |
| --- | --- | --- | --- |
| ⭐ | **A talks index** from the conference schedule (title, abstract, speakers, time). Use the official schedule export with no scraping, or type in the 20 to 30 talks that matter | The track is called "Find the Right Talk". An ask also returns matching talks ("see this talk at 2 pm"), speakers get talk evidence, and the free-time grid gets the real schedule | M |
| ⭐ | **Semantic reranking**: wrap the hybrid search in `text_similarity_reranker` with Elastic's hosted `.jina-reranker-v3.5` | Re-reads the top 50 results against the exact question, so the first card is the right expert more often | S |
| ⭐ | **A synonyms set**: k8s = kubernetes, PDB = pod disruption budget, ML = machine learning | The keyword half of hybrid stops missing jargon. The list lives in the index settings, so changing it means a rebuild (our Elastic key can't manage synonym sets) | S |
| ⭐ | **Conference pulse** with aggregations (`significant_text` and `terms` on the asks index) | "Trending questions in the room" (PRD FR-16) and the mix of ask types. Needs one route from B and a small screen from A | M |
| | **A Kibana dashboard** for organisers: asks by type, top topics, matches per hour | Shows Elasticsearch doing the analytics too, with no code | S |
| | **An AI summary at index time**: an inference pipeline asks an Elastic-hosted chat model for a one-line expert summary, stored in the `summary` field | Better matches for people with little evidence, and it saves OpenAI credits | M |
| | **Elastic's MCP server** (Agent Builder; check it is enabled on our trial) in Claude Code | We debug ranking in plain English ("why didn't Ana rank for preemption?"), and it makes a good demo line | S |
| | **ES\|QL** per-user stats (PRD FR-17): your asks, people reached, answered | A small "your progress" panel. Needs one route from B and a screen from A | M |

**Skipped on purpose:**

- Query rules: pinning people would make rankings unfair.
- Machine-learning anomaly jobs: requests live in Postgres, not Elasticsearch.
- Watcher: the app handles its own alerts.

## Sonar: Gitar and SonarQube Cloud

**Have now:** four required checks, Sonar's gate with real coverage, the gate report in CI, Convo review instructions, five rules, risk labels and auto-apply limits. Details are in [Quality-Gates.md](Quality-Gates.md).

**Add now**, free or on our Gitar Pro trial:

| | Add | What it gives Convo | Effort |
| --- | --- | --- | --- |
| ⭐ | **AI Code Assurance** (free): Sonar project → Administration → AI Code Assurance → "contains AI-generated code", then pick the AI-qualified gate | A stricter gate for exactly the code we write, an AI badge for the README, and honest disclosure (rule 5) | S |
| ⭐ | **Gitar as the approver**: require 1 approval on `main` and turn on Gitar's auto-approve. Test it on one PR first | If GitHub counts Gitar's approval, a clean PR still merges without waiting for a person, and a PR with findings can't merge until they're fixed. Probe 2 in Quality-Gates.md tells us whether we need this | S |
| ⭐ | **A Gitar skill**, `.gitar/skills/sonar-coverage/SKILL.md`: "write tests for the lines in the Sonar report, the Convo way" | Comment `gitar run the sonar-coverage skill on this` and Gitar writes tests that follow our patterns. This is the demo moment for "CI diagnosis and auto-apply" | S |
| | **Gitar auto-merge** for `b1/` and `b2/` PRs only, with criteria in `.gitar/config/merge.md` (never contract changes or High risk), plus GitHub's "Allow auto-merge" setting | B's PRs merge themselves once every gate passes, so nobody has to click merge. A's PRs still wait for a person | S |
| | **Slack** (Gitar Pro): one channel for "ready to merge" and "CI failed" | Both of you see PR status on the day without refreshing GitHub | S |
| | **Gitar Insights** | A screenshot for the demo: PRs reviewed, findings fixed, top CI failures | none |
| | **SonarQube MCP server** (free, needs a Sonar user token) | Claude Code checks Sonar's findings before pushing. The command is below | S |
| | **SonarQube for IDE** (free VS Code extension) | Sonar's findings while you edit | S |

**Needs another plan:**

| Plan | Unlocks | Worth it because |
| --- | --- | --- |
| **Open-source plans** (free): add an OSI licence such as MIT, then apply to each | Sonar for OSS: custom gates and rule sets, Sonar on stacked PRs, webhooks. Gitar Open Source: everything in Pro, unlimited seats, no trial end | One decision unlocks both for free. Both of you must agree on the licence, because the code is yours (rule 10) |
| **Sonar Team trial** (14 days, no card) | AI CodeFix (Sonar suggests fixes), Advanced Security (vulnerable or malicious dependencies, SBOM, licence policy), custom gates, stacked PRs | Supply-chain checks on our npm packages |
| **Gitar Enterprise** (through sales) | Cross-PR analysis; Agentic Security (reviews changes to `AGENTS.md`, `CLAUDE.md` and `.gitar/`); functional validation (checks a PR against its linked issue); thorough review; unlimited rules; custom MCP tools | Cross-PR would catch A's stacked PRs breaking each other. Two more rules are ready to add: screen PRs need Playwright with axe, and a new OpenAI call must be cached, batched and traced |

**SonarQube MCP** (PowerShell, needs Docker). Generate the token in Sonar under avatar → My Account → Security:

```powershell
$env:SONARQUBE_TOKEN = "<your Sonar user token>"
claude mcp add sonarqube --env SONARQUBE_TOKEN=$env:SONARQUBE_TOKEN --env SONARQUBE_ORG=akv-iu '--' docker run -i --rm --init --pull=always -e SONARQUBE_TOKEN -e SONARQUBE_ORG sonarsource/sonarqube-mcp
claude mcp list   # expect: sonarqube listed
```

Keep the quotes around `'--'`, because PowerShell can drop a bare `--`. The token stays in Claude Code's settings on your machine, never in the repo. Sonar also hosts this MCP server without Docker; see Sonar's MCP docs.

## Dash0

**Have now:** OpenTelemetry is registered in `src/instrumentation.ts`, and Phases 1 and 2 add one span per match step. The trial includes every feature for 14 days from sign-up.

| | Add | What it gives Convo | Effort |
| --- | --- | --- | --- |
| ⭐ | **The Vercel integration** (vercel.com/integrations/dash0) | Our server logs in Dash0, plus a ready-made Vercel dashboard and four alert rules, with no code | S |
| ⭐ | **AI spans**: `gen_ai.*` attributes (model, input and output tokens) on each OpenAI call | Dash0's Gen AI view shows tokens and cost per ask with no custom dashboard (a PRD metric) | S |
| ⭐ | **Real-user monitoring**: Dash0's web SDK in `src/app/layout.tsx` | Page speed, JS errors, session replay, and each click linked to its backend trace. Judges ask for this when there's a frontend. It's a shared file, so it needs a PR both of you approve | M |
| ⭐ | **An SLO**: "95% of matches under 2 s", with a burn-rate alert to Slack or email | The bonus point, and the number we show in the demo | S |
| ⭐ | **A health route and synthetic check**: `GET /api/health` checks Postgres, Elasticsearch and OpenAI, and Dash0 calls it on a schedule from outside | We learn "Neon is down" or "the Elastic key expired" before the demo, not during it | S |
| ⭐ | **Dash0 MCP in Claude Code, plus Agent0** (connect GitHub in Dash0) | Covers the "find and fix something real" requirement. See the scenario below | S |
| | **App metrics**: time per match step, tokens per ask, cache hit rate, and the funnel from sign-in to first ask, first request and resolved | The PRD's metrics, which feed the SLO and the dashboard (Phase 4) | M |
| | **Dashboards, alerts and SLOs as code** in the repo, applied with `dash0 apply` | Gitar reviews observability changes like code, and one command rebuilds everything | M |
| | **Deploy markers**: CI sends a `dash0.deployment` event on each push to `main` (needs a Dash0 auth token as a GitHub secret) | Charts and the SLO show which deploy changed latency | S |
| | **An Agent0 automation**: a failed check triggers Agent0 to investigate and post to Slack | The investigation is waiting for us when something breaks | S |

Service map, trace triage and Log AI need no work once data flows; show them in the demo.

**Dash0 MCP** (our account is in the US East region):

```powershell
claude mcp add --transport http --scope user dash0 https://api.us-east-1.aws.dash0.com/mcp
```

Then run `/mcp` in Claude Code and sign in to dash0. The MCP server is read-only; it's Agent0, in the Dash0 app, that opens fix PRs (1 to 2 credits each).

## One scenario that hits all three tracks

This is the demo story, and it fills the Build-Plan's Agent0 slot:

1. Dash0's SLO alert fires: for example, matches take 3.1 s at p95. Agent0 points at the slow step, `match.explain`.
2. Claude Code asks Dash0 through MCP for the slow spans and sees the explanations aren't cached.
3. Claude Code fixes it and opens a PR. Gitar checks our rules (is the AI call cached, batched and traced?), and Sonar checks the new code has tests. If the tests are missing, Gitar's skill writes them.
4. The PR merges, a deploy marker appears in Dash0, the SLO goes back under 2 s, and Elasticsearch still answers in about 100 ms.

## Keys and trials on the day

| What | Status | Do this |
| --- | --- | --- |
| **OpenAI** | The event gives each of us $50 of credits | Put the key in `.env.local` and in Vercel (Production and Preview); Phase 2 uses it. Fallback: Elastic-hosted models |
| **Gitar Pro** | Trial, ends about 20 November | After the hackathon, move to the open-source plan, pay, or remove `Gitar` from the required checks. Otherwise every PR gets stuck |
| **Dash0** | Trial with every feature, 14 days from sign-up | Check the end date in the Dash0 app |
| **Elastic Cloud** | Trial from sign-up | Check the end date in the Elastic console. Backup: Elastic's `start-local` (Docker, everything unlocked for a month) |
| **SonarQube Cloud** | Free plan, no expiry | Nothing |

Where a new key goes:

- `.env.local` for your machine (never committed).
- Vercel → Settings → Environment Variables for the deployed app.
- GitHub → Settings → Secrets and variables → Actions for CI.
- `claude mcp add` for tools in Claude Code.
