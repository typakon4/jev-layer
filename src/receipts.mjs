import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stableJson } from "./contract.mjs";
import { sanitizeContext } from "./context-filter.mjs";

const MAX_RESULT_BYTES = 8_000;

export function replayCasePath(filePath = process.env.JEV_REPLAY_CASES) {
  return resolve(filePath || ".jev/replay/cases.jsonl");
}

export function buildRoutingCase({ request, decision, recordedAt = new Date().toISOString() }) {
  const correlationId = decision.correlation_id ?? decision.receipt?.correlation_id ?? decision.receipt?.request_id;
  if (!correlationId) throw new TypeError("decision correlation_id is required");
  return {
    record_type: "routing_case",
    schema_version: 1,
    case_id: correlationId,
    correlation_id: correlationId,
    recorded_at: recordedAt,
    harness: request.harness ?? "unknown",
    request: replayRequest(request),
    decision: decisionSummary(decision),
  };
}

export function buildExecutionReceipt({ request, decision, host, recordedAt = new Date().toISOString() }) {
  const correlationId = decision.correlation_id ?? decision.receipt?.correlation_id ?? decision.receipt?.request_id;
  if (!correlationId) throw new TypeError("decision correlation_id is required");
  if (!host || typeof host !== "object") throw new TypeError("host execution is required");
  const exitStatus = Number.isInteger(host.exit_status) ? host.exit_status : null;
  const status = typeof host.status === "string"
    ? host.status
    : exitStatus === null || exitStatus === 0 ? "completed" : "failed";
  return {
    record_type: "execution_receipt",
    schema_version: 1,
    receipt_id: `${correlationId}:execution`,
    correlation_id: correlationId,
    recorded_at: recordedAt,
    harness: host.harness ?? request.harness ?? "unknown",
    candidates: decision.candidates ?? [],
    selected: decision.selected ?? null,
    confidence: decision.confidence ?? null,
    probabilities: decision.probabilities ?? {},
    fallback: decision.fallback ?? null,
    jev: {
      correlation_id: correlationId,
      request_id: decision.receipt?.request_id ?? correlationId,
      provider: decision.receipt?.provider ?? null,
      latency_ms: decision.receipt?.latency_ms ?? null,
      cost_usd: decision.receipt?.cost_usd ?? decision.raw_jev?.usage?.cost ?? null,
      status: decision.status ?? null,
    },
    host: {
      capability_id: host.capability_id ?? decision.selected ?? null,
      status,
      result: boundedValue(host.result ?? host.host_result ?? null),
      error: boundedValue(host.error ?? null),
      exit_status: exitStatus,
      duration_ms: finiteNumber(host.duration_ms),
      started_at: host.started_at ?? null,
      completed_at: host.completed_at ?? recordedAt,
      browser: boundedValue(host.browser ?? null),
    },
  };
}

export async function appendRoutingCase({ path, request, decision }) {
  const record = buildRoutingCase({ request, decision });
  await appendRecord(path, record);
  return { record, path: replayCasePath(path) };
}

export async function appendExecutionReceipt({ path, request, decision, host }) {
  const record = buildExecutionReceipt({ request, decision, host });
  await appendRecord(path, record);
  return { record, path: replayCasePath(path) };
}

export function buildSupervisionReceipt({ request, result, recordedAt = new Date().toISOString() }) {
  const correlationId = result.receipt?.correlation_id;
  if (!correlationId) throw new TypeError("supervision result correlation_id is required");
  return {
    record_type: "supervision_case",
    schema_version: 1,
    case_id: correlationId,
    correlation_id: correlationId,
    recorded_at: recordedAt,
    harness: request.harness ?? "unknown",
    request: {
      schema_version: request.schema_version ?? 1,
      harness: request.harness ?? "unknown",
      intent: request.intent,
      context: sanitizeContext(request.context ?? {}),
      actor_permissions: request.actor_permissions ?? [],
      policy: request.policy ?? {},
    },
    supervision: {
      status: result.status ?? null,
      action: result.action ?? "continue",
      reason: result.reason ?? null,
      assessment: result.assessment ?? null,
      evidence_state: result.evidence_state ?? request.context?.supervision?.evidence_state ?? null,
      policy: result.policy ?? null,
      jev: {
        provider: result.receipt.provider ?? null,
        latency_ms: result.receipt.latency_ms ?? null,
        cost_usd: result.receipt.cost_usd ?? null,
        dimensions: result.receipt.dimensions ?? null,
      },
    },
  };
}

export async function appendSupervisionReceipt({ path, request, result }) {
  const record = buildSupervisionReceipt({ request, result });
  await appendRecord(path, record);
  return { record, path: replayCasePath(path) };
}

export async function readRoutingCases(path) {
  const resolved = replayCasePath(path);
  let text;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
    try {
      const record = JSON.parse(line);
      return record.record_type === "routing_case" ? [{ ...record, source_line: index + 1 }] : [];
    } catch {
      return [];
    }
  });
}

export async function readSupervisionCases(path) {
  const resolved = replayCasePath(path);
  let text;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
    try {
      const record = JSON.parse(line);
      return record.record_type === "supervision_case" ? [{ ...record, source_line: index + 1 }] : [];
    } catch {
      return [];
    }
  });
}

function replayRequest(request) {
  return {
    schema_version: request.schema_version ?? 1,
    harness: request.harness ?? "unknown",
    intent: request.intent,
    context: sanitizeContext(request.context ?? {}),
    actor: request.actor,
    actor_permissions: Array.isArray(request.actor_permissions) ? request.actor_permissions.filter((value) => typeof value === "string") : undefined,
    policy: request.policy && typeof request.policy === "object" ? request.policy : {},
    capabilities: Array.isArray(request.capabilities) ? request.capabilities.map(replayCapability) : [],
  };
}

function replayCapability(capability) {
  const risk = capability.risk?.level ?? capability.risk ?? "medium";
  return {
    id: capability.id,
    kind: capability.kind ?? capability.type ?? "tool",
    name: capability.name,
    description: capability.description,
    permissions: Array.isArray(capability.permissions) ? capability.permissions.filter((value) => typeof value === "string") : [],
    risk,
    available: capability.available,
    availability: capability.availability,
    source: typeof capability.source === "string" ? capability.source : null,
    verified: capability.verified === true,
    metadata: capability.metadata && typeof capability.metadata === "object" ? capability.metadata : {},
    policy: capability.policy,
  };
}

function decisionSummary(decision) {
  return {
    status: decision.status ?? null,
    selected: decision.selected ?? null,
    confidence: decision.confidence ?? null,
    probabilities: decision.probabilities ?? {},
    fallback: decision.fallback ?? null,
    candidates: decision.candidates ?? [],
    receipt: {
      correlation_id: decision.receipt?.correlation_id ?? decision.correlation_id ?? null,
      request_id: decision.receipt?.request_id ?? null,
      provider: decision.receipt?.provider ?? null,
      latency_ms: decision.receipt?.latency_ms ?? null,
      cost_usd: decision.receipt?.cost_usd ?? decision.raw_jev?.usage?.cost ?? null,
      candidate_count: decision.receipt?.candidate_count ?? null,
      context_bytes: decision.receipt?.context_bytes ?? null,
    },
  };
}

async function appendRecord(path, record) {
  const resolved = replayCasePath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await appendFile(resolved, `${stableJson(record)}\n`, "utf8");
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function boundedValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_RESULT_BYTES ? `${value.slice(0, MAX_RESULT_BYTES)}…` : value;
  const sanitized = sanitizeContext(value);
  const encoded = stableJson(sanitized);
  return encoded.length > MAX_RESULT_BYTES ? `${encoded.slice(0, MAX_RESULT_BYTES)}…` : sanitized;
}
