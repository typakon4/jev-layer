import { createHash, randomUUID } from "node:crypto";

export const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
export const CAPABILITY_KINDS = new Set(["skill", "tool", "mcp", "cli", "dsh", "subagent", "model"]);

export function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex")}`;
}

export function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : stableJson(value), "utf8");
}

export function normalizeRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("route request must be an object");
  }
  const intent = typeof input.intent === "string" ? input.intent : input.request;
  if (typeof intent !== "string" || intent.trim() === "") {
    throw new TypeError("route request requires a non-empty intent");
  }
  if (!Array.isArray(input.capabilities)) {
    throw new TypeError("route request requires capabilities[]");
  }
  return {
    schema_version: input.schema_version ?? 1,
    harness: typeof input.harness === "string" ? input.harness : "unknown",
    intent: intent.trim(),
    context: input.context && typeof input.context === "object" ? input.context : {},
    actor: typeof input.actor === "string" ? input.actor : undefined,
    actor_permissions: Array.isArray(input.actor_permissions) ? input.actor_permissions.filter((value) => typeof value === "string") : undefined,
    capabilities: input.capabilities,
    policy: input.policy && typeof input.policy === "object" ? input.policy : {},
  };
}

export function decisionEnvelope({ status, selected, reason, provider, latencyMs, candidateCount, contextBytes, candidates = [], probabilities = {}, confidence = null, rawJev = null, fallback = null, requestId = randomUUID(), correlationId = requestId, costUsd = rawJev?.usage?.cost ?? null }) {
  return {
    schema_version: 1,
    correlation_id: correlationId,
    status,
    selected: selected ?? null,
    confidence,
    probabilities,
    reason,
    candidates,
    fallback,
    execution: { enabled: false, status: "not_started" },
    raw_jev: rawJev,
    receipt: {
      correlation_id: correlationId,
      request_id: requestId,
      provider,
      latency_ms: latencyMs,
      cost_usd: costUsd,
      candidate_count: candidateCount,
      context_bytes: contextBytes,
    },
  };
}
