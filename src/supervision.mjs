import { randomUUID } from "node:crypto";
import { stableJson } from "./contract.mjs";
import { resolveProvider } from "./providers/index.mjs";
import { appendSupervisionReceipt } from "./receipts.mjs";

export const SUPERVISION_ENV = "JEV_SUPERVISION";
export const SUPERVISION_DIMENSIONS = Object.freeze([
  "requirements_addressed",
  "verification_needed",
  "meaningful_progress",
  "worker_stuck",
  "work_off_track",
  "completion",
]);

const MAX_STATE_BYTES = 8_000;

export function supervisionEnabled(options = {}) {
  if (options.enabled === true) return true;
  if (options.enabled === false) return false;
  return process.env[SUPERVISION_ENV] === "1";
}

export function buildSupervisionRequest({
  job = {},
  observation = {},
  evidence = {},
  harness = "unknown",
  actor_permissions = [],
  policy = {},
} = {}) {
  return {
    schema_version: 1,
    harness,
    intent: "Assess supervised work against its requirements and verification evidence.",
    actor_permissions: Array.isArray(actor_permissions) ? actor_permissions.filter((value) => typeof value === "string") : [],
    policy: { ...policy },
    context: {
      job: bounded(job),
      observation: bounded(observation),
      evidence: bounded(evidence),
      supervision: {
        judgments: bounded(evidence?.judgments ?? {}),
      },
    },
  };
}

export function supervisionQuestions() {
  return Object.fromEntries(SUPERVISION_DIMENSIONS.map((dimension) => [dimension, {
    type: "noul",
    instructions: questionInstructions(dimension),
    criteria: {
      true: "The statement is supported by the supplied work state and evidence.",
      false: "The statement is not supported, is contradicted, or is unknown.",
    },
  }]));
}

export function normalizeAssessment(raw) {
  const answers = raw?.answers;
  if (!answers || typeof answers !== "object") throw new Error("supervision response has no answers object");
  const assessment = {};
  for (const dimension of SUPERVISION_DIMENSIONS) {
    const answer = answers[dimension];
    const probability = readProbability(answer);
    if (probability === null) throw new Error(`supervision response has no valid ${dimension} judgment`);
    assessment[dimension] = Number(probability.toFixed(4));
  }
  return assessment;
}

export function deterministicSupervisionPolicy({ assessment, evidence = {}, attempts = 0, policy = {} } = {}) {
  const values = assessment && typeof assessment === "object" ? assessment : {};
  const threshold = Number.isFinite(policy.threshold) ? Math.max(0, Math.min(1, policy.threshold)) : 0.7;
  const maxRetries = Number.isInteger(policy.max_retries) && policy.max_retries >= 0 ? policy.max_retries : 2;
  const verificationEvidence = evidence.verification_passed === true || evidence.tests_passed === true;

  if (value(values.worker_stuck) >= threshold) {
    return attempts < maxRetries
      ? { action: "retry", reason: "worker appears stuck and retry budget remains", policy_source: "deterministic_host_policy" }
      : { action: "escalate", reason: "worker appears stuck and retry budget is exhausted", policy_source: "deterministic_host_policy" };
  }
  if (value(values.work_off_track) >= threshold) {
    return attempts < maxRetries
      ? { action: "retry", reason: "work appears off track and retry budget remains", policy_source: "deterministic_host_policy" }
      : { action: "escalate", reason: "work appears off track and retry budget is exhausted", policy_source: "deterministic_host_policy" };
  }
  if (value(values.verification_needed) >= threshold || (value(values.completion) >= threshold && !verificationEvidence)) {
    return { action: "verify", reason: "verification is required before continuing or finishing", policy_source: "deterministic_host_policy" };
  }
  if (value(values.completion) >= threshold && value(values.requirements_addressed) >= threshold) {
    return { action: "finish", reason: "completion and requirement coverage are supported", policy_source: "deterministic_host_policy" };
  }
  return { action: "continue", reason: value(values.meaningful_progress) >= threshold ? "meaningful progress is supported" : "continue while evidence is incomplete", policy_source: "deterministic_host_policy" };
}

export async function superviseWork({
  job,
  observation,
  evidence,
  harness,
  actor_permissions,
  policy,
  provider = "demo",
  config,
  enabled,
  attempts = 0,
  receiptPath,
} = {}) {
  const started = performance.now();
  const request = buildSupervisionRequest({ job, observation, evidence, harness, actor_permissions, policy });
  const base = {
    status: "fallback",
    action: "continue",
    reason: "supervision unavailable",
    assessment: null,
    policy: null,
    request,
    metrics: { wall_time_ms: 0, jev_calls: 0, cost_usd: 0, failures: 0 },
    receipt: null,
  };

  if (!supervisionEnabled({ enabled })) return finalize(base, started, "disabled", 0);
  let resolved;
  try {
    resolved = resolveProvider(provider, { config });
    if (!resolved || typeof resolved.evaluate !== "function") throw new Error("provider does not support supervision evaluation");
  } catch (error) {
    return finalize(base, started, "provider_error", 1, error);
  }

  let raw;
  try {
    raw = await resolved.evaluate({ state: request, questions: supervisionQuestions() });
  } catch (error) {
    return finalize(base, started, "provider_error", 1, error);
  }

  let assessment;
  try {
    assessment = normalizeAssessment(raw);
  } catch (error) {
    return finalize({ ...base, raw_jev: raw }, started, "malformed_response", 1, error);
  }

  const selectedPolicy = deterministicSupervisionPolicy({ assessment, evidence, attempts, policy });
  const result = {
    status: "judged",
    action: selectedPolicy.action,
    reason: selectedPolicy.reason,
    assessment,
    policy: selectedPolicy,
    request,
    metrics: {
      wall_time_ms: Number((performance.now() - started).toFixed(3)),
      jev_calls: 1,
      cost_usd: finiteCost(raw?.usage?.cost),
      failures: 0,
    },
    receipt: {
      correlation_id: randomUUID(),
      provider: resolved.name ?? providerName(provider),
      latency_ms: Number((performance.now() - started).toFixed(3)),
      cost_usd: finiteCost(raw?.usage?.cost),
      dimensions: SUPERVISION_DIMENSIONS.length,
    },
  };
  if (receiptPath) {
    try {
      const appended = await appendSupervisionReceipt({ path: receiptPath, request, result });
      result.receipt_path = appended.path;
    } catch (error) {
      result.receipt_error = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

function finalize(result, started, reason, jevCalls, error = null) {
  const message = error instanceof Error ? error.message : error ? String(error) : reason;
  return {
    ...result,
    reason: message,
    metrics: {
      ...result.metrics,
      wall_time_ms: Number((performance.now() - started).toFixed(3)),
      jev_calls: jevCalls,
      failures: reason === "disabled" ? 0 : 1,
    },
    fallback: { type: reason, reason: message },
  };
}

function readProbability(answer) {
  if (typeof answer === "boolean") return answer ? 1 : 0;
  if (typeof answer === "number" && Number.isFinite(answer) && answer >= 0 && answer <= 1) return answer;
  if (!answer || typeof answer !== "object") return null;
  for (const key of ["probability", "p_true", "score", "value", "noul"]) {
    const value = answer[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
  }
  return null;
}

function questionInstructions(dimension) {
  const labels = {
    requirements_addressed: "The worker has addressed the stated requirements.",
    verification_needed: "Additional verification is needed before trusting the current work.",
    meaningful_progress: "The worker has made meaningful progress toward the goal.",
    worker_stuck: "The worker is stuck and is not making useful progress.",
    work_off_track: "The worker's current work is materially off track.",
    completion: "The work is complete for the stated requirements.",
  };
  return `Judge whether this statement is supported: ${labels[dimension]}`;
}

function bounded(value) {
  const encoded = stableJson(value ?? {});
  if (Buffer.byteLength(encoded, "utf8") <= MAX_STATE_BYTES) return value ?? {};
  return { truncated: true, preview: encoded.slice(0, MAX_STATE_BYTES) };
}

function value(assessment, key) {
  const candidate = key === undefined ? assessment : assessment?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function finiteCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function providerName(provider) {
  return typeof provider === "string" ? provider : "unknown";
}
