# Dash0 setup and verification

Branch: `b2/dash0-telemetry`, based on main after PR #26. No migration,
application dependency, B1 edit, shared contract edit, or metrics SDK is needed.
The user applies these assets; this PR does not configure the live account.

## What is measured

All assets select service `convo`, environment `production`. Preview and local
traffic are excluded. Use a separate dataset if testing other environments.

| Chart | Meaning |
| --- | --- |
| p95 time per match step | Duration of `match.understand`, `match.search`, `match.mutual`, `match.explain`, in milliseconds. |
| AI tokens per created ask | Reported input + output tokens divided by successful `POST /api/refine` requests in the chart window. A window average, not exact attribution to an ask ID: refinement and explanation happen in separate requests; retries and additional matches also consume tokens. |
| AI cache hit rate | Sum of cache entries hit / (entries hit + entries missed), covering refinement and explanation. It is entry-weighted, not the percentage of HTTP requests served from cache. No lookups means no rate, not 100%. |
| p95 POST /api/match | Next.js server-request duration, including authentication, database reads, registration replay and the four steps; all response statuses count. |

The SLO counts **95% of production POST /api/match server spans strictly under
2 seconds**, over Dash0's rolling 28-day window. Two seconds exactly is slow.
It uses good/total event counters, not an average of p95s or five-minute ratios.
It is a latency SLO: a fast error still satisfies latency. Dependency availability
is checked separately. No traffic is no data, never a fabricated success.
The counters select `next.span_type=BaseServer.handleRequest` as well as SERVER
kind: Vercel can add an outer server span, which must not count a request twice.
This measures the Next.js request, not browser/network or pre-runtime cold-start time.

`signal-metrics.json` converts existing numeric token/cache attributes to sums,
counts requests/fast requests, and records request durations in Dash0, before
Dash0 trace sampling. Only service/environment dimensions are retained: no
person, ask, trace ID, prompt, response, key, or repository text becomes a label.
The four-step chart queries Dash0's built-in span-duration metric. It describes
retained spans; disable trace sampling for an unbiased step chart and retain
traces to inspect all four steps. Configure `OTEL_TRACES_SAMPLER=always_on` in the
app: Dash0 cannot measure spans discarded before ingestion. The existing
Gen AI view also uses model/token span attributes for its cost display; no model
prices are hardcoded in Convo.

## Apply (PowerShell, from the repository root)

1. Install CLI v1.20.0 or newer from the [official releases](https://github.com/dash0hq/dash0-cli/releases)
   and put `dash0.exe` on PATH. Log in yourself; do not paste tokens into chat:

   ```powershell
   dash0 login --profile convo --api-url https://api.us-east-1.aws.dash0.com --agent-mode=false
   ```

   Pick the correct organization in the browser. The examples use dataset
   `default`; substitute your production dataset in **every** command if different.

2. In Dash0 Organization settings → Notification channels, create/select an email
   or Slack channel, verify its destination, and copy its channel ID. List IDs with:

   ```powershell
   dash0 -X notification-channels list --profile convo
   ```

3. Apply metrics first, then dashboard, SLO, burn alert and synthetic check.
   This block binds both alerts to your channel without editing committed files:

   ```powershell
   $channel = ([guid](Read-Host 'Notification channel ID')).ToString()
   dash0 -X api PUT /api/import/signal-to-metrics -f dash0/signal-metrics.json --profile convo --dataset default
   if ($LASTEXITCODE -ne 0) { throw 'Metric conversion apply failed' }
   dash0 apply -f dash0/dashboard.json --profile convo --dataset default
   if ($LASTEXITCODE -ne 0) { throw 'Dashboard apply failed' }
   dash0 apply -f dash0/match-slo.json --profile convo --dataset default
   if ($LASTEXITCODE -ne 0) { throw 'SLO apply failed' }
   $alert = Get-Content dash0/burn-alert.json -Raw | ConvertFrom-Json
   $alert.annotations | Add-Member -NotePropertyName 'dash0.com/notification-channel-ids' -NotePropertyValue $channel -Force
   $alert | ConvertTo-Json -Depth 30 | dash0 apply -f - --profile convo --dataset default
   if ($LASTEXITCODE -ne 0) { throw 'Burn alert apply failed' }
   $synthetic = Get-Content dash0/health-synthetic.json -Raw | ConvertFrom-Json
   $synthetic.spec.notifications.channels = @($channel)
   $synthetic | ConvertTo-Json -Depth 30 | dash0 apply -f - --profile convo --dataset default
   if ($LASTEXITCODE -ne 0) { throw 'Synthetic check apply failed' }
   ```

   Stable origins/IDs make repeats update these assets, not create duplicates.
   The atomic metrics import upserts only the listed rules; it does not delete
   unrelated rules. The CLI has no `apply` support for conversion rules, hence
   the documented raw API command. An ingest-only OTLP credential cannot apply
   account configuration: use your own logged-in administrator account.
   The four asset files pass v1.20.0's local `apply --dry-run` validation;
   metric conversion, synthetic and check-rule payloads also pass the published
   API schemas. Account permissions, query execution and delivery still need
   the live verification below.

## Complete manual checklist (live services)

1. Deploy this PR to production after review. Existing Postgres, Elasticsearch,
   OpenAI and OTLP settings must be configured there; keep values private.
   Use real routes/search/AI (`FAKE_API=0`, `FAKES` empty), service `convo`,
   environment `production`, and `OTEL_TRACES_SAMPLER=always_on`.
   `@vercel/otel` already supplies the production environment attribute on Vercel.
   Confirm the OTLP dataset matches the dataset used above. Do not enable a
   Dash0 sampling rule that drops Convo traces during this verification.
2. Open `https://convo-delta-snowy.vercel.app/api/health`. Expected HTTP 200:
   `{"status":"up","dependencies":{"postgres":"up","elasticsearch":"up","openai":"up"}}`.
   Any unavailable/misconfigured dependency returns `down` and HTTP 503;
   errors, URLs and credentials are never returned. This endpoint always probes
   real dependencies, even in fake app mode, and needs no GitHub session.
   Each provider has a five-second timeout and no SDK retry; concurrent requests
   share a result for 30 seconds per server instance. The synthetic runs every
   five minutes in US East, requires 200, disallows redirects and checks total
   time <=10 seconds. It may initially fail until deployment is complete.
3. Sign in with your own account and finish onboarding. In the browser console
   on that origin, paste this complete snippet (no earlier helper needed):

   ```js
   const createdResponse = await fetch('/api/refine', {
     method: 'POST', headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({text: 'How does Kubernetes scheduler preemption work?'})
   });
   if (!createdResponse.ok) throw new Error(`Refine: ${createdResponse.status}`);
   const created = await createdResponse.json();
   sessionStorage.setItem('convo.dash0.ask', created.askId);
   for (let attempt = 0; attempt < 2; attempt++) {
     const response = await fetch('/api/match', {
       method: 'POST', headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({askId: created.askId})
     });
     if (!response.ok) throw new Error(`Match: ${response.status}`);
     console.log({attempt, results: (await response.json()).length});
   }
   ```

4. In Dash0 Tracing, filter `service.name=convo`, environment `production`, last
   15 minutes, and operation `POST /api/match`. Open one server span's trace.
   Confirm the same trace contains **all four** `match.*` spans. Expand a
   non-cached `chat gpt-5.4-mini` span to see `gen_ai.usage.input_tokens` and
   `gen_ai.usage.output_tokens`; `match.explain` shows cache entry hits/misses.
   A repeat should use cached explanations when the same evidence is returned.
   No candidates means no explanation lookup/token usage; use an indexed topic.
5. Open dashboard **Convo matching**. Allow a few minutes for the one-minute
   conversion interval; use a time window that includes both refinement and
   matching. Confirm four step series, token usage, cache rate and full match
   latency. The charts should show actual latency even when it exceeds the goal.
6. Open SLO **95% of POST /api/match under 2 seconds**. Confirm target 95%,
   rolling 28 days, and data after Dash0's five-minute settling delay. Open the
   burn check: either fast or slow normalized burn above 1 for two minutes raises
   a degraded issue. This is not an alert on a single slow request. Use the
   channel's test function to confirm delivery; that tests delivery, not actual
   error-budget exhaustion. Do not create fake production traffic to turn it green.
7. Cleanup the test ask (run on the same origin):

   ```js
   const askId = sessionStorage.getItem('convo.dash0.ask');
   if (askId) {
     const response = await fetch(`/api/asks/${encodeURIComponent(askId)}/resolve`, {method: 'POST'});
     if (!response.ok) throw new Error(`Cleanup: ${response.status}`);
     sessionStorage.removeItem('convo.dash0.ask');
   }
   ```

   Resolution retains the ask's database history. Keep the monitoring assets:
   they're the feature, not test data. To stop scheduled probes, disable/delete
   **Convo dependency health**; disable the burn check separately if decommissioning.

The OpenAI probe makes one `GET /v1/models` metadata request (no pagination or
generation); its key needs model-list permission. It does not test the generation
model's access, billing quota or moderation. This avoids duplicating B1's model
constant or coupling health to a retired model. The Elastic ping does not test ELSER, reranking or index
contents. The SQL probe does not validate migrations. Full matching verifies
those paths separately. Failed remote calls are sanitized to `down`, not hidden
as a healthy fake or an empty success.

Sources: [span metrics](https://www.dash0.com/docs/dash0/opentelemetry/semconvs/metrics/spans),
[span-to-metric rules](https://www.dash0.com/docs/dash0/telemetry/signal-control/convert-signals-to-metrics),
[SLO definitions](https://www.dash0.com/docs/dash0/monitoring/alerting/create-slos),
[burn alerts](https://www.dash0.com/docs/dash0/monitoring/alerting/alert-on-slos),
[CLI](https://www.dash0.com/docs/dash0/miscellaneous/tooling/dash0-cli/commands),
[OpenAI model metadata](https://developers.openai.com/api/reference/resources/models/methods/list).
