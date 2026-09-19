import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readRoutingCases, readSupervisionCases, replayCasePath } from "../src/receipts.mjs";
import { deterministicSupervisionPolicy } from "../src/supervision.mjs";
import { routeRequest } from "../src/route.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = replayCasePath(args.input);
const provider = args.provider ?? process.env.JEV_REPLAY_PROVIDER ?? "demo";
const allCases = await readRoutingCases(inputPath);
const cases = args.limit ? allCases.slice(0, args.limit) : allCases;
const results = [];

for (const routingCase of cases) {
  const decision = await routeRequest(routingCase.request, { provider });
  if (decision.execution?.enabled) throw new Error(`replay attempted host execution for ${routingCase.case_id}`);
  results.push({
    source_case_id: routingCase.case_id,
    source_correlation_id: routingCase.correlation_id,
    replay_correlation_id: decision.correlation_id,
    surface: routingCase.request.context?.browser ? "browser" : "generic",
    harness: routingCase.harness,
    selected: decision.selected,
    confidence: decision.confidence,
    status: decision.status,
    fallback: decision.fallback?.type ?? null,
    latency_ms: decision.receipt?.latency_ms ?? null,
    cost_usd: decision.receipt?.cost_usd ?? decision.raw_jev?.usage?.cost ?? null,
    execution: decision.execution,
  });
}

const supervisionCases = args.limit
  ? (await readSupervisionCases(inputPath)).slice(0, args.limit)
  : await readSupervisionCases(inputPath);
const supervisionResults = supervisionCases.map((record) => ({
  source_case_id: record.case_id,
  source_correlation_id: record.correlation_id,
  harness: record.harness,
  assessment: record.supervision.assessment,
  recorded_action: record.supervision.action,
  replayed_policy: deterministicSupervisionPolicy({
    assessment: record.supervision.assessment,
    evidence: record.request.context?.evidence ?? {},
  }),
  host_execution: false,
}));


const summary = summarize(results);
summary.supervision_case_count = supervisionResults.length;
summary.supervision_policy_match_rate = rate(
  supervisionResults.filter((result) => result.replayed_policy.action === result.recorded_action).length,
  supervisionResults.length,
);
const report = {
  ok: true,
  source: inputPath,
  provider,
  replayed_cases: results.length,
  replayed_supervision_cases: supervisionResults.length,
  host_execution_calls: 0,
  summary,
  cases: results,
  supervision_cases: supervisionResults,
};

if (args.output) {
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));
function summarize(results) {
  const total = results.length;
  const fallbackCount = results.filter((result) => result.status === "fallback").length;
  const selectedCount = results.filter((result) => result.status === "selected" || result.status === "needs_confirmation").length;
  const noDecisionCount = results.filter((result) => result.status === "no_decision").length;
  const browserResults = results.filter((result) => result.surface === "browser");
  const confidences = results.map((result) => result.confidence).filter((value) => typeof value === "number");
  const latencies = results.map((result) => result.latency_ms).filter((value) => typeof value === "number");
  const costs = results.map((result) => result.cost_usd).filter((value) => typeof value === "number");
  return {
    selected_rate: rate(selectedCount, total),
    fallback_rate: rate(fallbackCount, total),
    no_decision_rate: rate(noDecisionCount, total),
    browser_case_count: browserResults.length,
    browser_selected_rate: rate(browserResults.filter((result) => result.status === "selected" || result.status === "needs_confirmation").length, browserResults.length),
    average_confidence: average(confidences),
    average_latency_ms: average(latencies),
    p50_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    total_cost_usd: Number(costs.reduce((sum, value) => sum + value, 0).toFixed(9)),
    status_counts: Object.fromEntries([...new Set(results.map((result) => result.status))].map((status) => [status, results.filter((result) => result.status === status).length])),
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.input = argv[++index];
    else if (value === "--provider") result.provider = argv[++index];
    else if (value === "--limit") result.limit = Number(argv[++index]);
    else if (value === "--output") result.output = argv[++index];
  }
  if (result.limit !== undefined && (!Number.isInteger(result.limit) || result.limit < 0)) throw new Error("--limit must be a non-negative integer");
  return result;
}

function average(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[Math.min(sorted.length - 1, rank)].toFixed(3));
}


function rate(part, total) {
  return total ? Number((part / total).toFixed(4)) : 0;
}
