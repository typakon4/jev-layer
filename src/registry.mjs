import { CAPABILITY_KINDS, RISK_ORDER } from "./contract.mjs";

const KIND_ALIASES = Object.freeze({ mcp_tool: "mcp" });

export const DEFAULT_POLICY = Object.freeze({
  min_confidence: 0.62,
  max_risk: "high",
  confirmation_risk_levels: ["medium", "high"],
});

export function normalizeCapability(raw, index = 0) {
  if (!raw || typeof raw !== "object") throw new TypeError(`capabilities[${index}] must be an object`);
  if (typeof raw.id !== "string" || raw.id.trim() === "") throw new TypeError(`capabilities[${index}].id is required`);
  if (typeof raw.name !== "string" || raw.name.trim() === "") throw new TypeError(`capabilities[${index}].name is required`);
  if (typeof raw.description !== "string" || raw.description.trim() === "") throw new TypeError(`capabilities[${index}].description is required`);

  const rawKind = raw.kind ?? raw.type ?? raw.execution?.mode ?? "tool";
  const kind = KIND_ALIASES[rawKind] ?? rawKind;
  if (!CAPABILITY_KINDS.has(kind)) throw new TypeError(`capabilities[${index}].kind is unsupported: ${rawKind}`);

  const risk = raw.risk?.level ?? raw.risk ?? "medium";
  if (!(risk in RISK_ORDER)) throw new TypeError(`capabilities[${index}].risk is unsupported: ${risk}`);

  return {
    id: raw.id.trim(),
    kind,
    name: raw.name.trim(),
    description: raw.description.trim(),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.filter((value) => typeof value === "string") : [],
    risk,
    available: raw.available !== false && raw.availability?.available !== false,
    availability_reason: raw.availability?.reason ?? null,
    source: typeof raw.source === "string" ? raw.source : null,
    verified: raw.verified === true,
    metadata: normalizeMetadata(raw.metadata ?? raw.discovery),
    execution: {
      mode: "host",
      target: typeof raw.execution?.target === "string" ? raw.execution.target : undefined,
    },
    requires_confirmation: Boolean(raw.policy?.requires_confirmation) || risk !== "low",
  };
}

export function normalizeCapabilities(rawCapabilities) {
  const seen = new Set();
  return rawCapabilities.map((raw, index) => {
    const capability = normalizeCapability(raw, index);
    if (seen.has(capability.id)) throw new TypeError(`duplicate capability id: ${capability.id}`);
    seen.add(capability.id);
    return capability;
  });
}

export function filterCapabilities(capabilities, request, policy = {}) {
  const effective = { ...DEFAULT_POLICY, ...policy };
  const maxRisk = effective.max_risk ?? "high";
  const actorPermissions = Array.isArray(request.actor_permissions) ? new Set(request.actor_permissions) : null;
  const assessments = capabilities.map((capability) => {
    let reason = null;
    if (!capability.available) reason = capability.availability_reason || "capability unavailable";
    else if (RISK_ORDER[capability.risk] > RISK_ORDER[maxRisk]) reason = `risk ${capability.risk} exceeds policy maximum ${maxRisk}`;
    else if (actorPermissions && capability.permissions.some((permission) => !actorPermissions.has(permission))) reason = "actor lacks required capability permissions";
    return { capability, filtered: Boolean(reason), filter_reason: reason };
  });
  return {
    policy: effective,
    assessments,
    eligible: assessments.filter((assessment) => !assessment.filtered).map((assessment) => assessment.capability),
  };
}
export function decisionCandidates(assessments, probabilities = {}, confidence = null) {
  return assessments.map(({ capability, filtered, filter_reason }) => ({
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    risk: capability.risk,
    available: capability.available,
    filtered,
    filter_reason,
    probability: typeof probabilities[capability.id] === "number" ? probabilities[capability.id] : null,
    confidence: confidence ?? null,
    requires_confirmation: capability.requires_confirmation,
    source: capability.source,
    verified: capability.verified,
    metadata: capability.metadata,
  }));
}

export function deterministicCandidate(capabilities, policy = {}) {
  let eligible = capabilities;
  const requestedId = typeof policy.deterministic_capability_id === "string" ? policy.deterministic_capability_id : null;
  if (requestedId) eligible = eligible.filter((capability) => capability.id === requestedId);
  if (typeof policy.prefer_kind === "string") eligible = eligible.filter((capability) => capability.kind === policy.prefer_kind);
  if (typeof policy.prefer_source === "string") eligible = eligible.filter((capability) => capability.source === policy.prefer_source);
  if (policy.prefer_verified === true) eligible = eligible.filter((capability) => capability.verified);
  if (eligible.length !== 1) return null;
  return {
    capability: eligible[0],
    reason: requestedId ? "explicit capability policy" : "one capability remains after deterministic policy",
  };
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = ["skill", "mcp", "cli", "dsh", "subagent", "model", "manifest", "source_ref"];
  return Object.fromEntries(allowed
    .filter((key) => typeof value[key] === "string" || typeof value[key] === "boolean")
    .map((key) => [key, value[key]]));
}
