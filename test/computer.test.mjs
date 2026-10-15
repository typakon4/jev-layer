import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { decideComputerStep } from "../src/computer.mjs";
import { PNG } from "./image-fixture.mjs";

const SCREENSHOT = { format: "png", data_base64: PNG, width: 400, height: 300 };
const SCROLL = { id: "scroll-down", operation: "scroll", args: { direction: "down", amount: 120 } };
const CLICK = { id: "save", operation: "click", target: "the Save button", args: { button: "left" }, risk: "low" };
const BOX = { left: 0.2, right: 0.6, top: 0.1, bottom: 0.5 };

function input(overrides = {}) {
  return { goal: "Inspect the application", observation: { screenshot: SCREENSHOT, visible_text: "Save", application: "Editor" }, actions: [SCROLL], actor_permissions: ["computer"], ...overrides };
}

function grounding(visibility = 0.99, confidence = 0.95, box = BOX) {
  return { answers: { target_visible: { type: "noul", noul: visibility }, target_box: { type: "box", box, confidence } } };
}

function provider({ choice, confidence = 1, result = grounding(), error = false } = {}) {
  return {
    name: "computer-test", supportsImages: true, choices: [], groundings: [],
    async decide(request) {
      this.choices.push(request);
      const selected = choice ?? request.candidates[0].id;
      return { answers: { tool: { type: "choice", choice: selected, confidence, probabilities: { [selected]: confidence } } } };
    },
    async evaluate(request) {
      this.groundings.push(request);
      if (error) throw new Error("offline");
      return result;
    },
  };
}

function assertFallback(result, type) {
  assert.equal(result.action, null);
  assert.equal(result.decision.status, "fallback");
  if (type) assert.equal(result.decision.fallback.type, type);
  assert.equal(result.decision.execution.enabled, false);
  assert.equal(result.decision.correlation_id, result.decision.receipt.correlation_id);
}

test("computer advice is opt-in and an explicit disable overrides the environment", async () => {
  const previous = process.env.JEV_COMPUTER_USE;
  const engine = provider();
  try {
    delete process.env.JEV_COMPUTER_USE;
    assertFallback(await decideComputerStep(input(), { provider: engine }), "computer_use_disabled");
    process.env.JEV_COMPUTER_USE = "1";
    assertFallback(await decideComputerStep(input(), { enabled: false, provider: engine }), "computer_use_disabled");
    assert.equal(engine.choices.length, 0);
    const enabled = await decideComputerStep(input(), { provider: engine });
    assert.equal(enabled.decision.status, "selected");
    assert.deepEqual(enabled.action.args, SCROLL.args);
    assert.deepEqual(enabled.decision.execution, { enabled: false, status: "not_started" });
  } finally {
    if (previous === undefined) delete process.env.JEV_COMPUTER_USE;
    else process.env.JEV_COMPUTER_USE = previous;
  }
});

test("malformed screenshots and non-closed action arguments fail open before provider calls", async () => {
  const engine = provider();
  for (const candidate of [
    input({ observation: {} }),
    input({ observation: { screenshot: { ...SCREENSHOT, data_base64: "file:///screen.png" } } }),
    input({ observation: { screenshot: { ...SCREENSHOT, data_base64: Buffer.from("not an image").toString("base64") } } }),
    input({ observation: { screenshot: { ...SCREENSHOT, width: 800 } } }),
    input({ actions: [{ ...SCROLL, operation: "shell", args: { command: "anything" } }] }),
    input({ actions: [{ ...SCROLL, args: { direction: "down", command: "anything" } }] }),
    input({ actions: [{ ...CLICK, target: undefined }] }),
    input({ actions: [{ ...CLICK, args: { x: 400, y: 20 } }] }),
    input({ actions: [{ ...CLICK, args: { x: 20 } }] }),
    input({ actions: [SCROLL, SCROLL] }),
    input({ actions: Array.from({ length: 33 }, (_, index) => ({ ...SCROLL, id: `scroll-${index}` })) }),
    input({ policy: { min_target_visibility: Number.NaN } }),
    input({ policy: { min_box_confidence: 0 } }),
  ]) assertFallback(await decideComputerStep(candidate, { enabled: true, provider: engine }), "invalid_input");
  assert.equal(engine.choices.length, 0);
  assert.equal(engine.groundings.length, 0);
});

test("registry filters enforce explicit computer permission, availability, extra permissions, and risk", async () => {
  const engine = provider();
  for (const candidate of [
    input({ actor_permissions: undefined }),
    input({ actor_permissions: [] }),
    input({ actions: [{ ...SCROLL, permissions: ["administrator"] }] }),
    input({ actions: [{ ...SCROLL, available: false }] }),
    input({ actions: [{ ...SCROLL, availability: { available: false, reason: "offline" } }] }),
    input({ actions: [{ ...SCROLL, risk: "high" }], policy: { max_risk: "low" } }),
  ]) {
    const result = await decideComputerStep(candidate, { enabled: true, provider: engine });
    assert.equal(result.decision.status, "no_decision");
    assert.equal(result.action, null);
    assert.equal(result.decision.execution.enabled, false);
    assert.ok(result.decision.candidates.every((item) => item.filtered));
  }
  assert.equal(engine.choices.length, 0);
});

test("consequential actions require confirmation even at low risk", async () => {
  for (const action of [
    { id: "click", operation: "click", args: { x: 17, y: 29, button: "right" }, risk: "low" },
    { id: "type", operation: "type", args: { text: "host supplied text" }, risk: "low" },
    { id: "key", operation: "key", args: { keys: ["Control", "S"] }, risk: "low" },
    { ...SCROLL, consequential: true },
    { ...SCROLL, requires_confirmation: true },
    { ...SCROLL, policy: { requires_confirmation: true } },
  ]) {
    const engine = provider();
    const result = await decideComputerStep(input({ actions: [action], policy: { confirmation_risk_levels: [] } }), { enabled: true, provider: engine });
    assert.equal(result.decision.status, "needs_confirmation");
    assert.equal(result.decision.candidates[0].requires_confirmation, true);
    assert.equal(result.decision.execution.enabled, false);
    assert.equal(engine.groundings.length, 0);
  }
});

test("only the chosen described click is grounded, once, and mapped to bound screenshot pixels", async () => {
  const engine = provider({ choice: "save" });
  const result = await decideComputerStep(input({ actions: [SCROLL, CLICK, { ...CLICK, id: "other", target: "Cancel button" }] }), { enabled: true, provider: engine });
  assert.equal(result.decision.status, "needs_confirmation");
  assert.deepEqual(result.action.args, { button: "left", x: 160, y: 90 });
  assert.equal(result.action.target, CLICK.target);
  assert.deepEqual(result.action.grounding, { box: BOX, visibility: 0.99, confidence: 0.95, coordinate_space: "screenshot_pixels" });
  assert.equal(result.action.screenshot.sha256, `sha256:${createHash("sha256").update(Buffer.from(PNG, "base64")).digest("hex")}`);
  assert.equal(result.action.screenshot.requires_current, true);
  assert.equal(result.action.screenshot.width, 400);
  assert.equal(result.action.screenshot.height, 300);
  assert.equal(engine.groundings.length, 1);
  assert.equal(JSON.stringify(result.request.context).includes(PNG), false);
  assert.equal(JSON.stringify(result.decision).includes(PNG), false);
  assert.deepEqual(CLICK.args, { button: "left" });
});

test("absent, malformed, and uncertain grounding yields no action while retaining routing correlation", async () => {
  const badResults = [
    [grounding(0), "target_not_visible"],
    [grounding(0.899), "target_not_visible"],
    [grounding(0.99, 0.799), "low_grounding_confidence"],
    [grounding(Number.NaN), "malformed_grounding"],
    [grounding(Infinity), "malformed_grounding"],
    [grounding("0.99"), "malformed_grounding"],
    [grounding(0.99, Infinity), "malformed_grounding"],
    [{ answers: { target_box: grounding().answers.target_box } }, "malformed_grounding"],
    [grounding(0.99, 0.95, { ...BOX, left: -0.1 }), "malformed_grounding"],
    [grounding(0.99, 0.95, { ...BOX, right: 1.1 }), "malformed_grounding"],
    [grounding(0.99, 0.95, { ...BOX, left: BOX.right }), "malformed_grounding"],
    [grounding(0.99, 0.95, { ...BOX, top: BOX.bottom + 0.1 }), "malformed_grounding"],
    [grounding(0.99, 0.95, { ...BOX, bottom: Number.NaN }), "malformed_grounding"],
  ];
  for (const [raw, type] of badResults) {
    const result = await decideComputerStep(input({ actions: [CLICK] }), { enabled: true, provider: provider({ result: raw }) });
    assertFallback(result, type);
    assert.equal(result.decision.selected, CLICK.id);
    assert.equal(result.decision.receipt.provider, "computer-test");
    assert.equal(result.decision.receipt.candidate_count, 1);
  }
});

test("host grounding thresholds are inclusive and edge pixels remain inside the screenshot", async () => {
  const engine = provider({ result: grounding(0.95, 0.9, { left: 0.999, right: 1, top: 0.999, bottom: 1 }) });
  const result = await decideComputerStep(input({ actions: [CLICK], policy: { min_target_visibility: 0.95, min_box_confidence: 0.9 } }), { enabled: true, provider: engine });
  assert.deepEqual(result.action.args, { button: "left", x: 399, y: 299 });
  const stricter = await decideComputerStep(input({ actions: [CLICK] }), { enabled: true, provider: engine, policy: { min_target_visibility: 0.96 } });
  assertFallback(stricter, "target_not_visible");
});

test("route fallback, provider failures, unsupported images, and unknown selections never leak actions", async () => {
  assertFallback(await decideComputerStep(input(), { enabled: true, provider: provider({ confidence: 0.2 }) }), "low_confidence");
  assertFallback(await decideComputerStep(input(), { enabled: true, provider: provider({ choice: "not-host-supplied" }) }), "invalid_selection");
  assertFallback(await decideComputerStep(input({ actions: [CLICK] }), { enabled: true, provider: provider({ error: true }) }), "provider_error");
  const unavailable = provider();
  unavailable.supportsImages = false;
  assertFallback(await decideComputerStep(input(), { enabled: true, provider: unavailable }), "unsupported_images");
  assert.equal(unavailable.choices.length, 0);
  const noGrounding = provider();
  delete noGrounding.evaluate;
  assertFallback(await decideComputerStep(input({ actions: [CLICK] }), { enabled: true, provider: noGrounding }), "grounding_unavailable");
  const broken = provider();
  broken.decide = async () => { throw new Error("offline"); };
  assertFallback(await decideComputerStep(input(), { enabled: true, provider: broken }), "provider_error");
});

test("handoff is advisory and nonselected described targets are never grounded", async () => {
  const engine = provider({ choice: "handoff" });
  const action = { id: "handoff", operation: "handoff", args: { reason: "Host planning needed" }, available: true, risk: "low" };
  const result = await decideComputerStep(input({ actions: [CLICK, action] }), { enabled: true, provider: engine });
  assert.equal(result.decision.status, "selected");
  assert.equal(result.action.operation, "handoff");
  assert.equal(engine.groundings.length, 0);
  assert.equal(result.decision.execution.enabled, false);
});
