import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelRouteReport } from "../src/model-route-metrics.mjs";

const rows = [
  {
    record_type: "routing_case",
    correlation_id: "one",
    request: { context: { model_route: { mode: "shadow", profiles: [{ id: "fast" }, { id: "frontier" }] } } },
    decision: { status: "selected", selected: "fast", receipt: { latency_ms: 4, cost_usd: 0.001 } },
  },
  {
    record_type: "execution_receipt",
    correlation_id: "one",
    host: {
      status: "completed",
      duration_ms: 20,
      result: { model_route: { actual_model_id: "fast", retry_count: 1, outcome: "verified" } },
    },
  },
  {
    record_type: "routing_case",
    correlation_id: "two",
    request: { context: { model_route: { mode: "shadow", profiles: [{ id: "fast" }, { id: "frontier" }] } } },
    decision: { status: "selected", selected: "frontier", receipt: { latency_ms: 6, cost_usd: 0.002 } },
  },
  {
    record_type: "execution_receipt",
    correlation_id: "two",
    host: {
      status: "failed",
      duration_ms: 30,
      result: { model_route: { actual_model_id: "fast", retry_count: 2, outcome: "failed" } },
    },
  },
];

test("model route report joins shadow recommendation to host outcome without treating it as a route change", () => {
  const report = buildModelRouteReport(rows);
  assert.equal(report.schema_version, 1);
  assert.equal(report.summary.decisions, 2);
  assert.equal(report.summary.with_host_outcome, 2);
  assert.equal(report.summary.recommendation_match_rate, 0.5);
  assert.equal(report.summary.verified_outcomes, 1);
  assert.equal(report.summary.failed_outcomes, 1);
  assert.equal(report.summary.total_retry_count, 3);
  assert.deepEqual(report.models.map((row) => row.recommended_model_id), ["fast", "frontier"]);
  assert.equal(report.models[0].host_actual_model_ids.fast, 1);
  assert.equal(report.models[1].host_actual_model_ids.fast, 1);
  assert.equal(report.models[1].recommendation_matches, 0);
});

test("model route report fails open on incomplete or unrelated receipts", () => {
  const report = buildModelRouteReport([
    { record_type: "routing_case", correlation_id: "unrelated", request: { context: {} }, decision: { selected: "tool" } },
    { record_type: "routing_case", correlation_id: "pending", request: { context: { model_route: { mode: "shadow" } } }, decision: { selected: null } },
  ]);
  assert.equal(report.summary.decisions, 1);
  assert.equal(report.summary.with_host_outcome, 0);
  assert.equal(report.models[0].recommended_model_id, "unrecommended");
});
