import assert from "node:assert/strict";
import { test } from "node:test";
import { buildShadowCompactionReport } from "../src/shadow-compaction.mjs";

const context = {
  messages: [
    "stale casual discussion",
    "Requirement: preserve /workspace/project/config.json exactly",
    "recent working note",
  ],
  tool_results: [
    "plain old tool output",
  ],
};

test("shadow compaction is report-only, preserves pinned evidence, and exposes candidate decisions", async () => {
  const before = JSON.stringify(context);
  let received;
  const report = await buildShadowCompactionReport({
    intent: "prepare a safe compaction report",
    context,
    provider: {
      name: "shadow-test-provider",
      async evaluate(input) {
        received = input;
        return {
          answers: {
            item_0: { type: "noul", probability: 0.1, confidence: 0.9 },
            item_1: { type: "noul", probability: 0.9, confidence: 0.9 },
            item_2: { type: "noul", probability: 0.4, confidence: 0.2 },
          },
          usage: { cost: 0.0002 },
        };
      },
    },
  });

  assert.equal(JSON.stringify(context), before);
  assert.equal(report.mode, "jev_shadow");
  assert.equal(report.status, "judged");
  assert.equal(report.changed, false);
  assert.equal(report.candidate_count, 4);
  assert.equal(report.protected_count, 1);
  assert.equal(report.droppable_count, 1);
  assert.equal(report.retained_count, 3);
  assert.ok(received.questions.item_0);
  assert.equal(report.items.find((item) => item.id === "messages[1]").decision, "keep");
  assert.equal(report.items.find((item) => item.id === "messages[1]").reason, "pinned:path,requirement");
  assert.equal(report.items.find((item) => item.id === "messages[0]").decision, "drop_candidate");
  assert.equal(report.items.find((item) => item.id === "tool_results[0]").decision, "keep");
  assert.equal(report.items.find((item) => item.id === "tool_results[0]").reason, "low_confidence");
});

test("shadow compaction fails open and marks all unresolved items as retained", async () => {
  const report = await buildShadowCompactionReport({
    intent: "prepare a safe compaction report",
    context: { messages: ["old note"] },
    provider: { name: "offline", async evaluate() { throw new Error("provider unavailable"); } },
  });

  assert.equal(report.status, "fallback");
  assert.equal(report.changed, false);
  assert.equal(report.droppable_count, 0);
  assert.equal(report.retained_count, 1);
  assert.equal(report.items[0].decision, "keep");
  assert.equal(report.items[0].reason, "provider_error");
});
