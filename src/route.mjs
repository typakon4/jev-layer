import { byteLength, decisionEnvelope, normalizeRequest } from "./contract.mjs";
import { projectState } from "./context-filter.mjs";
import { discoverCapabilities } from "./discovery.mjs";
import { decisionCandidates, DEFAULT_POLICY, deterministicCandidate, filterCapabilities, normalizeCapabilities } from "./registry.mjs";
import { resolveProvider } from "./providers/index.mjs";

export async function routeRequest(input, options = {}) {
  const discovered = options.discovery ? discoverCapabilities(options.discovery) : [];
  const request = normalizeRequest(discovered.length ? { ...input, capabilities: [...(Array.isArray(input?.capabilities) ? input.capabilities : []), ...discovered] } : input);
  if (options.engine === "jevrouter") return routeViaJevRouter(request, options);

  const started = performance.now();
  const effectivePolicy = { ...DEFAULT_POLICY, ...request.policy, ...(options.policy ?? {}) };
  const capabilities = normalizeCapabilities(request.capabilities);
  const { policy, assessments, eligible } = filterCapabilities(capabilities, request, effectivePolicy);
  const projection = projectState(request, eligible, options.maxContextBytes ?? 6_000, { mode: options.contextFilterMode });
  const base = {
    provider: typeof options.provider === "string" ? options.provider : options.provider?.name ?? "jev-demo",
    candidateCount: eligible.length,
    contextBytes: projection.context_bytes,
    started,
  };

  if (process.env.JEV_LAYER_ENABLED === "0") {
    return fallback(base, assessments, "disabled", "Jev layer disabled by JEV_LAYER_ENABLED=0", projection.state);
  }
  let provider;
  try {
    provider = resolveProvider(options.provider ?? "demo", options);
    base.provider = provider.name;
  } catch (error) {
    return fallback(base, assessments, "provider_error", error instanceof Error ? error.message : String(error), projection.state);
  }
  if (eligible.length === 0) {
    return decisionEnvelope({
      status: "no_decision",
      reason: "no capability passed availability, risk, and permission policy",
      provider: provider.name,
      latencyMs: elapsed(started),
      candidateCount: 0,
      contextBytes: projection.context_bytes,
      candidates: decisionCandidates(assessments),
    });
  }
  const deterministic = policy.deterministic === true
    ? deterministicCandidate(eligible, policy)
    : null;
  if (deterministic) {
    const selected = deterministic.capability;
    const probabilities = Object.fromEntries(eligible.map((candidate) => [candidate.id, candidate.id === selected.id ? 1 : 0]));
    const candidates = decisionCandidates(assessments, probabilities, 1);
    const requiresConfirmation = policy.confirmation_risk_levels.includes(selected.risk) || selected.requires_confirmation;
    return decisionEnvelope({
      status: requiresConfirmation ? "needs_confirmation" : "selected",
      reason: deterministic.reason,
      provider: `${provider.name}:deterministic`,
      latencyMs: elapsed(started),
      candidateCount: eligible.length,
      contextBytes: projection.context_bytes,
      candidates,
      selected: selected.id,
      probabilities,
      confidence: 1,
    });
  }

  let raw;
  try {
    raw = await provider.decide({ state: projection.state, candidates: eligible });
  } catch (error) {
    return fallback(base, assessments, "provider_error", error instanceof Error ? error.message : String(error), projection.state);
  }

  let answer;
  try {
    answer = readChoiceAnswer(raw);
  } catch (error) {
    return fallback(base, assessments, "malformed_response", error instanceof Error ? error.message : String(error), projection.state, raw);
  }

  const selected = eligible.find((candidate) => candidate.id === answer.choice);
  const candidates = decisionCandidates(assessments, answer.probabilities, answer.confidence);
  if (!selected) {
    return decisionEnvelope({
      status: "fallback",
      reason: `provider selected unknown or filtered capability: ${answer.choice}`,
      provider: provider.name,
      latencyMs: elapsed(started),
      candidateCount: eligible.length,
      contextBytes: projection.context_bytes,
      candidates,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      rawJev: raw,
      fallback: { type: "invalid_selection", reason: "selection is not in the eligible candidate set" },
    });
  }
  if (answer.confidence < policy.min_confidence) {
    return decisionEnvelope({
      status: "fallback",
      reason: `confidence ${answer.confidence.toFixed(3)} is below policy minimum ${policy.min_confidence.toFixed(3)}`,
      provider: provider.name,
      latencyMs: elapsed(started),
      candidateCount: eligible.length,
      contextBytes: projection.context_bytes,
      candidates,
      selected: selected.id,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
      rawJev: raw,
      fallback: { type: "low_confidence", reason: "host must continue with normal planning" },
    });
  }

  const requiresConfirmation = policy.confirmation_risk_levels.includes(selected.risk) || selected.requires_confirmation;
  return decisionEnvelope({
    status: requiresConfirmation ? "needs_confirmation" : "selected",
    reason: requiresConfirmation ? "selected capability requires host confirmation" : "selected by bounded Jev decision",
    provider: provider.name,
    latencyMs: elapsed(started),
    candidateCount: eligible.length,
    contextBytes: projection.context_bytes,
    candidates,
    selected: selected.id,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    rawJev: raw,
  });
}

function readChoiceAnswer(raw) {
  const answers = raw?.answers;
  if (!answers || typeof answers !== "object") throw new Error("response has no answers object");
  const answer = answers.tool ?? Object.values(answers).find((value) => value?.type === "choice");
  if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || !answer.probabilities || typeof answer.probabilities !== "object") {
    throw new Error("response does not contain a valid Choice answer");
  }
  const probabilities = Object.fromEntries(Object.entries(answer.probabilities).map(([id, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`invalid probability for ${id}`);
    return [id, value];
  }));
  const confidence = typeof answer.confidence === "number" ? answer.confidence : Math.max(...Object.values(probabilities), 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("invalid confidence");
  return { choice: answer.choice, probabilities, confidence };
}

function fallback(base, assessments, type, reason, state, rawJev = null) {
  return decisionEnvelope({
    status: "fallback",
    reason,
    provider: base.provider,
    latencyMs: elapsed(base.started),
    candidateCount: base.candidateCount,
    contextBytes: byteLength(state),
    candidates: decisionCandidates(assessments),
    rawJev,
    fallback: { type, reason },
  });
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(3));
}

async function routeViaJevRouter(request, options) {
  const started = performance.now();
  const capabilities = normalizeCapabilities(request.capabilities);
  const { assessments, eligible } = filterCapabilities(capabilities, request, { ...DEFAULT_POLICY, ...request.policy, ...(options.policy ?? {}) });
  const projection = projectState(request, eligible, options.maxContextBytes ?? 6_000, { mode: options.contextFilterMode });
  if (eligible.length === 0) return decisionEnvelope({ status: "no_decision", reason: "no eligible capability", provider: "jevrouter", latencyMs: elapsed(started), candidateCount: 0, contextBytes: projection.context_bytes, candidates: decisionCandidates(assessments) });

  let module;
  try {
    module = await import("jevrouter");
  } catch (error) {
    return fallback({ provider: "jevrouter", candidateCount: eligible.length, contextBytes: projection.context_bytes, started }, assessments, "dependency_error", error instanceof Error ? error.message : String(error), projection.state);
  }
  try {
    const result = await module.route({
      request: request.intent,
      context: projection.state.context,
      candidates: eligible.map(toJevRouterCapability),
    }, {
      provider: options.innerProvider ?? process.env.JEVROUTER_PROVIDER ?? "demo",
      policy: options.policy,
    });
    const selected = result.decision?.selected ?? null;
    const raw = result.raw_jev ?? null;
    const candidates = decisionCandidates(assessments, Object.fromEntries((result.decision?.candidates ?? []).map((candidate) => [candidate.id, candidate.jev_probability ?? 0])), null);
    return decisionEnvelope({
      status: result.status === "selected" ? "selected" : result.status === "needs_confirmation" ? "needs_confirmation" : "fallback",
      selected,
      reason: result.fallback?.reason ?? "selected by JevRouter",
      provider: `jevrouter:${options.innerProvider ?? process.env.JEVROUTER_PROVIDER ?? "demo"}`,
      latencyMs: elapsed(started),
      candidateCount: eligible.length,
      contextBytes: projection.context_bytes,
      candidates,
      rawJev: raw,
      fallback: result.fallback?.type ? { type: result.fallback.type, reason: result.fallback.reason } : null,
    });
  } catch (error) {
    return fallback({ provider: "jevrouter", candidateCount: eligible.length, contextBytes: projection.context_bytes, started }, assessments, "provider_error", error instanceof Error ? error.message : String(error), projection.state);
  }
}

function toJevRouterCapability(capability) {
  return {
    id: capability.id,
    name: capability.name,
    type: capability.kind === "mcp" ? "mcp_tool" : capability.kind,
    description: capability.description,
    permissions: capability.permissions,
    risk: { level: capability.risk },
    availability: { available: capability.available },
    execution: { mode: capability.kind === "mcp" ? "mcp" : capability.kind, target: capability.execution.target },
    policy: { requires_confirmation: capability.requires_confirmation },
  };
}
