import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverCapabilities } from "../src/discovery.mjs";
import { routeRequest } from "../src/route.mjs";

function discovered() {
  return discoverCapabilities({
    skills: [{ id: "skill:inspect", name: "Inspect skill", description: "Inspect work", verified: true }],
    mcp: [{ id: "mcp:search", name: "Search MCP", description: "Search files" }],
    cli: [{ id: "cli:git", name: "Git CLI", command: "git", description: "Run git" }],
    dsh: [{ id: "dsh:worker", name: "Worker DSH", description: "Delegate work" }],
    subagents: [{ id: "subagent:review", name: "Review subagent", description: "Review code" }],
    models: [{ id: "model:jev", name: "Jev model", description: "Make bounded decisions" }],
    tools: [{ id: "tool:read", name: "Read tool", description: "Read files" }],
  });
}

test("discovery normalizes skills, MCP, CLI, DSH, subagent, model, and tool candidates", () => {
  const capabilities = discovered();
  assert.deepEqual(new Set(capabilities.map((capability) => capability.kind)), new Set(["skill", "mcp", "cli", "dsh", "subagent", "model", "tool"]));
  assert.equal(capabilities.find((capability) => capability.id === "cli:git").metadata.cli, "git");
  assert.equal(capabilities.find((capability) => capability.id === "skill:inspect").verified, true);
});

test("explicit deterministic policy selects one discovered capability before Jev", async () => {
  let providerCalls = 0;
  const decision = await routeRequest({
    intent: "make a bounded model decision",
    context: { request: "model" },
    policy: { deterministic: true, prefer_kind: "model", prefer_verified: true },
  }, {
    discovery: { models: [{ id: "model:jev", name: "Jev model", description: "Make bounded decisions", verified: true, risk: "low" }] },
    provider: { name: "must-not-run", async decide() { providerCalls += 1; throw new Error("deterministic route should not call Jev"); } },
  });
  assert.equal(providerCalls, 0);
  assert.equal(decision.status, "selected");
  assert.equal(decision.selected, "model:jev");
  assert.equal(decision.receipt.provider, "must-not-run:deterministic");
  assert.equal(decision.candidates[0].verified, true);
});

test("availability policy excludes an unavailable discovered capability", async () => {
  const decision = await routeRequest({
    intent: "inspect",
    context: {},
    policy: { deterministic: true, deterministic_capability_id: "tool:offline" },
  }, {
    discovery: { tools: [{ id: "tool:offline", name: "Offline", description: "Unavailable", available: false }] },
    provider: "demo",
  });
  assert.equal(decision.status, "no_decision");
  assert.equal(decision.candidates[0].filtered, true);
  assert.equal(decision.candidates[0].filter_reason, "capability unavailable");
});
