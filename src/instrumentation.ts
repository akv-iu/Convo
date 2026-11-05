/**
 * OpenTelemetry (B2). Exports to Dash0 when OTEL_EXPORTER_OTLP_ENDPOINT and
 * OTEL_EXPORTER_OTLP_HEADERS are set; otherwise traces stay local.
 */
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "convo" });
}
