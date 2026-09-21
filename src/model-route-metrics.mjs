/**
 * Read-only analysis for model-route shadow cases. Recommendations stay
 * advisory: this module joins evidence; it never changes host model settings.
 */
export function buildModelRouteReport(records = []) {
  const routes = new Map();
  const executions = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== "object" || typeof record.correlation_id !== "string") continue;
    if (record.record_type === "routing_case" && record.request?.context?.model_route?.mode === "shadow") routes.set(record.correlation_id, record);
    if (record.record_type === "execution_receipt") executions.set(record.correlation_id, record);
  }

  const rows = [...routes.values()].map((route) => toRow(route, executions.get(route.correlation_id))).sort((a, b) => a.recommended_model_id.localeCompare(b.recommended_model_id));
  return {
    schema_version: 1,
    mode: "shadow",
    generated_at: new Date().toISOString(),
    summary: summarize(rows),
    models: groupByRecommendation(rows),
  };
}

function toRow(route, execution) {
  const result = execution?.host?.result?.model_route;
  const recommended = string(route.decision?.selected, "unrecommended");
  const actual = string(result?.actual_model_id, null);
  const outcome = string(result?.outcome, execution ? string(execution.host?.status, "unknown") : null);
  return {
    correlation_id: route.correlation_id,
    recommended_model_id: recommended,
    actual_model_id: actual,
    recommendation_match: actual !== null && actual === recommended,
    outcome,
    retry_count: boundedInteger(result?.retry_count),
    host_duration_ms: finite(execution?.host?.duration_ms),
    jev_latency_ms: finite(route.decision?.receipt?.latency_ms),
    jev_cost_usd: finite(route.decision?.receipt?.cost_usd),
  };
}

function summarize(rows) {
  const matched = rows.filter((row) => row.recommendation_match).length;
  const actual = rows.filter((row) => row.actual_model_id !== null).length;
  return {
    decisions: rows.length,
    with_host_outcome: rows.filter((row) => row.outcome !== null).length,
    with_actual_model: actual,
    recommendation_matches: matched,
    recommendation_match_rate: actual ? matched / actual : null,
    verified_outcomes: rows.filter((row) => row.outcome === "verified" || row.outcome === "completed").length,
    failed_outcomes: rows.filter((row) => row.outcome === "failed").length,
    total_retry_count: rows.reduce((sum, row) => sum + (row.retry_count ?? 0), 0),
    total_jev_cost_usd: sum(rows.map((row) => row.jev_cost_usd)),
    average_jev_latency_ms: average(rows.map((row) => row.jev_latency_ms)),
    average_host_duration_ms: average(rows.map((row) => row.host_duration_ms)),
  };
}

function groupByRecommendation(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const group = grouped.get(row.recommended_model_id) ?? {
      recommended_model_id: row.recommended_model_id,
      decisions: 0,
      with_host_outcome: 0,
      recommendation_matches: 0,
      verified_outcomes: 0,
      failed_outcomes: 0,
      total_retry_count: 0,
      host_actual_model_ids: {},
    };
    group.decisions += 1;
    if (row.outcome !== null) group.with_host_outcome += 1;
    if (row.recommendation_match) group.recommendation_matches += 1;
    if (row.outcome === "verified" || row.outcome === "completed") group.verified_outcomes += 1;
    if (row.outcome === "failed") group.failed_outcomes += 1;
    group.total_retry_count += row.retry_count ?? 0;
    if (row.actual_model_id) group.host_actual_model_ids[row.actual_model_id] = (group.host_actual_model_ids[row.actual_model_id] ?? 0) + 1;
    grouped.set(row.recommended_model_id, group);
  }
  return [...grouped.values()].sort((a, b) => a.recommended_model_id.localeCompare(b.recommended_model_id));
}

function string(value, fallback) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function finite(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function boundedInteger(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
function sum(values) { return values.reduce((total, value) => total + (value ?? 0), 0); }
function average(values) { const present = values.filter((value) => value !== null); return present.length ? sum(present) / present.length : null; }
