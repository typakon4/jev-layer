import assert from "node:assert/strict";
import { test } from "node:test";
import { filterContext } from "../src/relevance-filter.mjs";
import { projectState } from "../src/context-filter.mjs";
import { routeRequest } from "../src/route.mjs";

const capabilities = [{ id: "inspect", kind: "tool", name: "Inspect", description: "Inspect the supplied context", risk: "low" }];

function messages() {
  return [
    ...Array.from({ length: 10 }, (_, index) => `old unrelated note ${index}`),
    "Requirement: preserve /workspace/project/config.json exactly",
    "command: `npm test` failed with exit status 1; Error: fixture failed",
    "recent worker update",
  ];
}

test("shadow mode never mutates context and reports evidence", () => {
  const context = { messages: messages() };
  const before = JSON.stringify(context);
  const result = filterContext(context, { mode: "shadow", recent: 2 });
  assert.strictEqual(result.context, context);
  assert.equal(JSON.stringify(context), before);
  assert.equal(result.report.mode, "shadow");
  assert.equal(result.report.changed, false);
  assert.ok(result.report.pinned >= 2);
});

test("conservative mode drops stale noise but preserves exact evidence", () => {
  const result = filterContext({ messages: messages() }, { mode: "conservative", recent: 2 });
  assert.equal(result.report.mode, "conservative");
  assert.equal(result.report.changed, true);
  assert.ok(result.report.dropped > 0);
  assert.ok(result.context.messages.includes("Requirement: preserve /workspace/project/config.json exactly"));
  assert.ok(result.context.messages.includes("command: `npm test` failed with exit status 1; Error: fixture failed"));
  assert.ok(!result.context.messages.includes("old unrelated note 0"));
});

test("route projection applies explicit filtering without losing pinned evidence", async () => {
  let captured;
  const decision = await routeRequest({
    intent: "inspect project state",
    policy: { context_filter_mode: "conservative" },
    context: { messages: messages() },
    capabilities,
  }, {
    provider: {
      name: "context-filter-test-provider",
      async decide({ state }) {
        captured = state;
        return { answers: { tool: { type: "choice", choice: "inspect", probabilities: { inspect: 1 }, confidence: 1 } } };
      },
    },
  });
  assert.equal(decision.status, "selected");
  assert.equal(captured.context_filter.mode, "conservative");
  assert.ok(captured.context.messages.includes("Requirement: preserve /workspace/project/config.json exactly"));
  assert.ok(captured.context.messages.includes("command: `npm test` failed with exit status 1; Error: fixture failed"));
});

test("no mode keeps the existing projection contract", () => {
  const result = projectState({ intent: "inspect", context: { messages: ["plain"] } }, capabilities, 6_000);
  assert.equal(result.state.context_filter, undefined);
  assert.deepEqual(result.state.context, { messages: ["plain"] });
});
