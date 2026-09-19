import assert from "node:assert/strict";
import { test } from "node:test";
import { projectState } from "../src/context-filter.mjs";
import { routeRequest } from "../src/route.mjs";

const candidates = [
  { id: "search", kind: "mcp", name: "Repository search", description: "Search repository files and symbols", permissions: ["read"], risk: "low" },
  { id: "write", kind: "tool", name: "File writer", description: "Modify repository files", permissions: ["write"], risk: "high" },
];

function request(overrides = {}) {
  return {
    harness: "test",
    intent: "Search repository files",
    context: { workspace: "test", api_key: "hidden" },
    actor_permissions: ["read"],
    capabilities: candidates,
    ...overrides,
  };
}

test("routes to an eligible capability without executing it", async () => {
  const decision = await routeRequest(request(), { provider: "demo" });
  assert.equal(decision.status, "selected");
  assert.equal(decision.selected, "search");
  assert.deepEqual(decision.execution, { enabled: false, status: "not_started" });
  assert.equal(decision.candidates.find((candidate) => candidate.id === "write").filtered, true);
});

test("returns no_decision when every candidate is unavailable or forbidden", async () => {
  const decision = await routeRequest(request({ capabilities: [
    { ...candidates[0], availability: { available: false, reason: "offline" } },
    candidates[1],
  ] }), { provider: "demo" });
  assert.equal(decision.status, "no_decision");
  assert.equal(decision.execution.enabled, false);
});

test("fails open on provider errors and malformed responses", async () => {
  const providerError = await routeRequest(request(), { provider: { name: "test-error", async decide() { throw new Error("down"); } } });
  assert.equal(providerError.status, "fallback");
  assert.equal(providerError.fallback.type, "provider_error");

  const malformed = await routeRequest(request(), { provider: { name: "test-malformed", async decide() { return { answers: { tool: { type: "score" } } }; } } });
  assert.equal(malformed.status, "fallback");
  assert.equal(malformed.fallback.type, "malformed_response");
});

test("falls back when confidence is below the code threshold", async () => {
  const decision = await routeRequest(request({ intent: "Do something unrelated", actor_permissions: ["read", "write"] }), { provider: "demo", policy: { min_confidence: 0.99 } });
  assert.equal(decision.status, "fallback");
  assert.equal(decision.fallback.type, "low_confidence");
});

test("filters secrets and bounds provider state", () => {
  const projection = projectState(request({ context: { api_key: "hidden", nested: { password: "hidden-too" }, note: "safe" } }), candidates, 1_000);
  const serialized = JSON.stringify(projection.state);
  assert.equal(serialized.includes("hidden"), false);
  assert.equal(serialized.includes("safe"), true);
  assert.ok(projection.context_bytes <= 1_000);
});

test("honors explicit disablement with fail-open fallback", async () => {
  const previous = process.env.JEV_LAYER_ENABLED;
  process.env.JEV_LAYER_ENABLED = "0";
  try {
    const decision = await routeRequest(request(), { provider: "demo" });
    assert.equal(decision.status, "fallback");
    assert.equal(decision.fallback.type, "disabled");
  } finally {
    if (previous === undefined) delete process.env.JEV_LAYER_ENABLED;
    else process.env.JEV_LAYER_ENABLED = previous;
  }
});
