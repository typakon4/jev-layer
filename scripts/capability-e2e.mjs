import assert from "node:assert/strict";
import { routeRequest } from "../src/route.mjs";

let providerCalls = 0;
const decision = await routeRequest({
  harness: "capability-e2e",
  intent: "use the verified model for a bounded decision",
  context: { task: "model" },
  policy: { deterministic: true, prefer_kind: "model", prefer_verified: true },
}, {
  discovery: {
    skills: [{ id: "skill:inspect", name: "Inspect skill", description: "Inspect context" }],
    models: [{ id: "model:verified", name: "Verified model", description: "Make bounded decisions", verified: true, risk: "low", source: "e2e-manifest" }],
    tools: [{ id: "tool:offline", name: "Offline tool", description: "Unavailable", available: false }],
  },
  provider: { name: "capability-e2e-provider", async decide() { providerCalls += 1; throw new Error("deterministic selection should not call Jev"); } },
});
assert.equal(providerCalls, 0);
assert.equal(decision.status, "selected");
assert.equal(decision.selected, "model:verified");
assert.equal(decision.candidates.find((candidate) => candidate.id === "model:verified").source, "e2e-manifest");
assert.equal(decision.candidates.find((candidate) => candidate.id === "model:verified").verified, true);
console.log(JSON.stringify({
  ok: true,
  status: decision.status,
  selected: decision.selected,
  provider: decision.receipt.provider,
  deterministic: true,
  jev_calls: providerCalls,
  candidate_metadata: decision.candidates.find((candidate) => candidate.id === decision.selected),
}, null, 2));
