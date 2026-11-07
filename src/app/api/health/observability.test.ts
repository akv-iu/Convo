import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../../dash0/${name}.json`, import.meta.url), "utf8"));
const Filter = z.object({ key: z.string(), operator: z.enum(["is", "is_set", "lt"]), value: z.union([z.string(), z.object({ intValue: z.string() })]).optional() });
const metrics = z.object({ items: z.array(z.object({
  metadata: z.object({ labels: z.record(z.string(), z.string()) }),
  spec: z.object({ match: z.object({ signal: z.literal("spans"), filters: Filter.array() }),
    output: z.object({ name: z.string(), type: z.literal("sum").optional(), value: z.string().optional(), monotonic: z.boolean().optional() }),
  }),
})) }).parse(read("signal-metrics"));

function selected(name: string, attributes: Record<string, string | number>): boolean {
  const rule = metrics.items.find(rule => rule.spec.output.name === name);
  if (!rule) throw new Error(`Metric missing: ${name}`);
  return rule.spec.match.filters.every(filter => {
    const actual = attributes[filter.key];
    if (filter.operator === "is_set") return actual !== undefined;
    if (filter.operator === "lt") return typeof actual === "number" && typeof filter.value === "object" && actual < Number(filter.value.intValue);
    return String(actual) === filter.value;
  });
}

const requestSpan = { "service.name": "convo", "deployment.environment.name": "production", "dash0.operation.name": "POST /api/match", "otel.span.kind": "SERVER", "next.span_type": "BaseServer.handleRequest" };

describe("Dash0 assets", () => {
  it("counts exactly one production server request, excluding child calls and other routes", () => {
    expect(selected("convo.match.requests", requestSpan)).toBe(true);
    for (const changed of [{ "otel.span.kind": "CLIENT" }, { "deployment.environment.name": "preview" }, { "dash0.operation.name": "GET /api/health" }, { "service.name": "another-service" }, { "next.span_type": "platform-wrapper" }]) {
      expect(selected("convo.match.requests", { ...requestSpan, ...changed })).toBe(false);
    }
  });

  it.each([[0, true], [1_999_999_999, true], [2_000_000_000, false], [2_000_000_001, false]])(
    "classifies %i nanoseconds against the strict two-second objective", (duration, fast) => {
      expect(selected("convo.match.fast", { ...requestSpan, "otel.span.duration": duration })).toBe(fast);
    },
  );

  it("counts only successful ask creations and reads numeric token/cache attributes rather than counting calls", () => {
    const ask = { ...requestSpan, "dash0.operation.name": "POST /api/refine", "http.response.status_code": 200 };
    expect(selected("convo.ask.created", ask)).toBe(true);
    expect(selected("convo.ask.created", { ...ask, "http.response.status_code": 503 })).toBe(false);
    for (const [metric, attribute] of [["tokens.input", "gen_ai.usage.input_tokens"], ["tokens.output", "gen_ai.usage.output_tokens"], ["cache.hits", "convo.ai.cache_hits"], ["cache.misses", "convo.ai.cache_misses"]]) {
      expect(selected(`convo.ai.${metric}`, requestSpan)).toBe(false);
      expect(selected(`convo.ai.${metric}`, { ...requestSpan, [attribute]: 8 })).toBe(true);
      expect(metrics.items.find(rule => rule.spec.output.name === `convo.ai.${metric}`)?.spec.output).toMatchObject({ type: "sum", monotonic: true, value: `attributes["${attribute}"]` });
    }
  });

  it("uses event counters for the 95% SLO and selects burn alerts by the stable SLO label", () => {
    const slo = z.object({ metadata: z.object({ labels: z.record(z.string(), z.string()) }), spec: z.object({
      indicator: z.object({ spec: z.object({ ratioMetric: z.object({ counter: z.literal(true),
        good: z.object({ metricSource: z.object({ spec: z.object({ query: z.string() }) }) }),
        total: z.object({ metricSource: z.object({ spec: z.object({ query: z.string() }) }) }),
      }) }) }), objectives: z.array(z.object({ target: z.number() })),
    }) }).parse(read("match-slo"));
    expect(slo.spec.objectives[0].target).toBe(0.95);
    expect(slo.spec.indicator.spec.ratioMetric.good.metricSource.spec.query).toMatch(/^\{otel_metric_name="convo.match.fast",.*\}$/);
    expect(slo.spec.indicator.spec.ratioMetric.total.metricSource.spec.query).toMatch(/^\{otel_metric_name="convo.match.requests",.*\}$/);
    const alert = z.object({ expression: z.string(), thresholds: z.object({ degraded: z.number() }) }).parse(read("burn-alert"));
    expect(alert.expression).toContain(`slo="${slo.metadata.labels.slo}"`);
    expect(alert.expression).toContain("dash0.slo.burn_rate.fast");
    expect(alert.expression).toContain("dash0.slo.burn_rate.slow");
    expect(alert.thresholds.degraded).toBe(1);
    expect(new Set(metrics.items.map(rule => rule.metadata.labels["dash0.com/origin"])).size).toBe(metrics.items.length);
  });

  it("checks the public health endpoint without redirects, generated tokens or request credentials", () => {
    const synthetic = z.object({ kind: z.literal("Dash0SyntheticCheck"), spec: z.object({ plugin: z.object({ spec: z.object({ request: z.object({
      method: z.literal("get"), url: z.url(), redirects: z.literal("disabled"), headers: z.array(z.unknown()).length(0),
      tls: z.object({ allowInsecure: z.literal(false) }),
    }) }) }), schedule: z.object({ interval: z.literal("5m") }) }) }).parse(read("health-synthetic"));
    expect(synthetic.spec.plugin.spec.request.url).toBe("https://convo-delta-snowy.vercel.app/api/health");
  });
});
