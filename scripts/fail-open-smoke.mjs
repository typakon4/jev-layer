import assert from "node:assert/strict";
import { routeRequest } from "../src/route.mjs";

const candidates = [
  {
    id: "read_manifest",
    name: "read",
    kind: "tool",
    description: "Read the repository package manifest without modifying it.",
    execution: { mode: "native", target: "read" },
    permissions: ["read"],
    risk: "low",
  },
  {
    id: "read_route",
    name: "read",
    kind: "tool",
    description: "Read the routing implementation without modifying it.",
    execution: { mode: "native", target: "read" },
    permissions: ["read"],
    risk: "low",
  },
];

const request = {
  intent: "inspect repository metadata",
  harness: "fail-open-smoke",
  context: { workspace: "jev-layer", operation: "read-only" },
  actor_permissions: ["read"],
  capabilities: candidates,
};

const originalEnabled = process.env.JEV_LAYER_ENABLED;
const disabled = await withEnv("JEV_LAYER_ENABLED", "0", () => routeRequest(request, { provider: "openrouter" }));
restoreEnv("JEV_LAYER_ENABLED", originalEnabled);
assert.equal(disabled.status, "fallback");
assert.equal(disabled.fallback.type, "disabled");
assert.equal(disabled.execution.enabled, false);

const unavailable = await routeRequest(request, {
  provider: "openrouter",
  openrouter: {
    apiKey: "smoke-token",
    endpoint: "http://127.0.0.1:1/unavailable",
    timeoutMs: 100,
  },
});
assert.equal(unavailable.status, "fallback");
assert.equal(unavailable.fallback.type, "provider_error");
assert.equal(unavailable.execution.enabled, false);

const noDecision = await routeRequest({
  ...request,
  capabilities: candidates.map((candidate) => ({
    ...candidate,
    availability: { available: false, reason: "host capability intentionally unavailable" },
  })),
}, { provider: "demo" });
assert.equal(noDecision.status, "no_decision");
assert.equal(noDecision.execution.enabled, false);

const lowConfidence = await routeRequest(request, {
  provider: {
    name: "low-confidence-smoke-provider",
    async decide() {
      return {
        answers: {
          tool: {
            type: "choice",
            choice: "read_manifest",
            probabilities: { read_manifest: 0.51, read_route: 0.49 },
            confidence: 0.51,
          },
        },
      };
    },
  },
  policy: { min_confidence: 0.8 },
});
assert.equal(lowConfidence.status, "fallback");
assert.equal(lowConfidence.fallback.type, "low_confidence");
assert.equal(lowConfidence.selected, "read_manifest");
assert.equal(lowConfidence.execution.enabled, false);

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    summarize("disabled", disabled),
    summarize("provider_unavailable", unavailable),
    summarize("no_decision", noDecision),
    summarize("low_confidence", lowConfidence),
  ],
}, null, 2));

async function withEnv(name, value, operation) {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await operation();
  } finally {
    restoreEnv(name, previous);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function summarize(name, result) {
  return {
    name,
    status: result.status,
    selected: result.selected,
    fallback: result.fallback?.type ?? null,
    confidence: result.confidence ?? null,
    latency_ms: result.latency_ms,
    execution: result.execution,
  };
}
