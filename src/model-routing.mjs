import { routeRequest } from "./route.mjs";

/**
 * Recommend one host-declared model profile for the next model call.
 * This is a shadow decision: it never mutates the host model/provider setting.
 */
export async function recommendModelRoute({
  intent,
  context = {},
  models,
  harness = "unknown",
  policy = {},
  provider = "demo",
  config,
} = {}) {
  if (!Array.isArray(models) || models.length === 0) throw new TypeError("models[] is required");
  const profiles = models.map(normalizeProfile);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const decision = await routeRequest({
    harness,
    intent,
    context: { ...context, model_route: { mode: "shadow", profiles: profiles.map(publicProfile) } },
    capabilities: profiles.map(toCapability),
    policy: {
      ...policy,
      // A recommendation must never create an approval boundary by itself.
      confirmation_risk_levels: [],
    },
  }, { provider, config });
  return {
    ...decision,
    route_mode: "shadow",
    recommended_model: decision.selected ? publicProfile(profileById.get(decision.selected)) : null,
  };
}

function normalizeProfile(value, index) {
  if (!value || typeof value !== "object") throw new TypeError(`models[${index}] must be an object`);
  const id = required(value.id, `models[${index}].id`);
  const model = required(value.model ?? value.id, `models[${index}].model`);
  const provider = string(value.provider, "unknown");
  const reasoning_effort = string(value.reasoning_effort, "default");
  const description = string(value.description, `${provider}/${model}; reasoning=${reasoning_effort}`);
  return {
    id,
    provider,
    model,
    reasoning_effort,
    description,
    available: value.available !== false && value.availability?.available !== false,
    availability_reason: value.availability?.reason ?? null,
  };
}

function toCapability(profile) {
  return {
    id: profile.id,
    kind: "model",
    name: profile.model,
    description: profile.description,
    risk: "low",
    available: profile.available,
    availability: { available: profile.available, reason: profile.availability_reason },
    source: profile.provider,
    metadata: { model: profile.model },
  };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    provider: profile.provider,
    model: profile.model,
    reasoning_effort: profile.reasoning_effort,
    available: profile.available,
  };
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function string(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
