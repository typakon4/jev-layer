import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendModelRoute } from "../src/model-routing.mjs";

const models = [
  {
    id: "fast",
    provider: "openrouter",
    model: "small-model",
    reasoning_effort: "low",
    description: "fast and cheap for simple classification or file inspection",
  },
  {
    id: "frontier",
    provider: "openai-codex",
    model: "frontier-model",
    reasoning_effort: "high",
    description: "strong model for difficult implementation and ambiguous reasoning",
  },
];

test("model routing returns an advisory profile and never changes the host route", async () => {
  let captured;
  const result = await recommendModelRoute({
    intent: "classify a small batch of already structured feedback",
    context: { task_size: "small", external_side_effects: false },
    models,
    provider: {
      name: "model-route-test-provider",
      async decide(input) {
        captured = input;
        return {
          answers: { tool: { type: "choice", choice: "fast", probabilities: { fast: 0.92, frontier: 0.08 }, confidence: 0.92 } },
          usage: { cost: 0.0001 },
        };
      },
    },
  });

  assert.equal(result.route_mode, "shadow");
  assert.equal(result.status, "selected");
  assert.equal(result.selected, "fast");
  assert.equal(result.recommended_model.model, "small-model");
  assert.equal(result.execution.enabled, false);
  assert.equal(captured.candidates.every((candidate) => candidate.kind === "model"), true);
});

test("model routing excludes unavailable profiles and fails open with no selected profile", async () => {
  const result = await recommendModelRoute({
    intent: "inspect a file",
    models: [{ ...models[0], available: false }],
    provider: "demo",
  });

  assert.equal(result.status, "no_decision");
  assert.equal(result.selected, null);
  assert.equal(result.recommended_model, null);
  assert.equal(result.execution.enabled, false);
});
