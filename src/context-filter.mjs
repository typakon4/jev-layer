import { byteLength, stableJson } from "./contract.mjs";
import { filterContext, normalizeRelevanceMode } from "./relevance-filter.mjs";
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|session)/i;
const MAX_STRING = 2_000;
const MAX_DEPTH = 4;

export function sanitizeContext(value, depth = 0, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeContext(item, depth + 1, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([childKey, childValue]) => [childKey, sanitizeContext(childValue, depth + 1, childKey)]));
  }
  return String(value);
}

export function projectState(request, capabilities, maxBytes = 6_000, options = {}) {
  const configuredMode = options.mode ?? request.policy?.context_filter_mode ?? process.env.JEV_CONTEXT_FILTER;
  const relevanceMode = normalizeRelevanceMode(configuredMode);
  const relevance = filterContext(request.context, { mode: configuredMode, recent: options.recent });
  const state = {
    intent: request.intent.length > MAX_STRING ? `${request.intent.slice(0, MAX_STRING)}…` : request.intent,
    context: sanitizeContext(relevance.context),
    capabilities: capabilities.map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      name: capability.name,
      description: capability.description,
      risk: capability.risk,
    })),
  };
  if (relevanceMode) state.context_filter = relevance.report;

  let encoded = stableJson(state);
  if (byteLength(encoded) <= maxBytes) return { state, context_bytes: byteLength(encoded), truncated: false };
  if (relevanceMode) {
    state.context_filter = { ...state.context_filter, over_budget: true };
    return { state, context_bytes: byteLength(encoded), truncated: true };
  }

  state.context = {};
  state.context_truncated = true;
  encoded = stableJson(state);
  if (byteLength(encoded) <= maxBytes) return { state, context_bytes: byteLength(encoded), truncated: true };

  state.capabilities = state.capabilities.map(({ id, kind, name, risk }) => ({ id, kind, name, risk }));
  encoded = stableJson(state);
  if (byteLength(encoded) <= maxBytes) return { state, context_bytes: byteLength(encoded), truncated: true };

  state.capabilities = state.capabilities.slice(0, 32);
  state.capabilities_truncated = true;
  state.intent = state.intent.slice(0, Math.max(128, maxBytes - byteLength(stableJson(state))));
  return { state, context_bytes: byteLength(stableJson(state)), truncated: true };
}
