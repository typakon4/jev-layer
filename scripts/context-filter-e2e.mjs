import assert from "node:assert/strict";
import { routeRequest } from "../src/route.mjs";

const messages = [
  ...Array.from({ length: 12 }, (_, index) => `stale unrelated worker note ${index}`),
  "Requirement: preserve /workspace/project/config.json exactly",
  "Error: command `npm test` failed with exit status 1",
  "recent worker state",
];
const context = { messages };
const before = JSON.stringify(context);
let projected;
const decision = await routeRequest({
  harness: "context-filter-e2e",
  intent: "inspect project state",
  context,
  policy: { context_filter_mode: "conservative" },
  capabilities: [{ id: "inspect", kind: "tool", name: "Inspect", description: "Inspect context", risk: "low" }],
}, {
  provider: {
    name: "context-filter-e2e-provider",
    async decide({ state }) {
      projected = state;
      return { answers: { tool: { type: "choice", choice: "inspect", probabilities: { inspect: 1 }, confidence: 1 } } };
    },
  },
});
assert.equal(decision.status, "selected");
assert.equal(projected.context_filter.mode, "conservative");
assert.ok(projected.context_filter.dropped > 0);
assert.ok(projected.context.messages.includes("Requirement: preserve /workspace/project/config.json exactly"));
assert.ok(projected.context.messages.includes("Error: command `npm test` failed with exit status 1"));
assert.equal(JSON.stringify(context), before);
console.log(JSON.stringify({
  ok: true,
  status: decision.status,
  mode: projected.context_filter.mode,
  kept: projected.context_filter.kept,
  dropped: projected.context_filter.dropped,
  pinned: projected.context_filter.pinned,
  preserved: [
    projected.context.messages.includes("Requirement: preserve /workspace/project/config.json exactly"),
    projected.context.messages.includes("Error: command `npm test` failed with exit status 1"),
  ],
}, null, 2));
