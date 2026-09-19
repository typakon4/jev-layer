import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildBrowserRequest, browserActions, decideBrowserStep, runBrowserFastPath } from "../src/browser.mjs";
import { readRoutingCases } from "../src/receipts.mjs";
import { routeRequest } from "../src/route.mjs";
function providerFor(choices) {
  let call = 0;
  return {
    name: "browser-test-provider",
    async decide({ candidates }) {
      const requested = choices[call++] ?? "browser:handoff";
      const choice = candidates.some((candidate) => candidate.id === requested)
        ? requested
        : candidates.find((candidate) => candidate.id === "browser:handoff")?.id ?? candidates[0]?.id;
      return {
        answers: { tool: { type: "choice", choice, probabilities: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.id === choice ? 1 : 0])), confidence: 1 } },
        usage: { cost: 0.0001 },
      };
    },
  };
}

test("browser request exposes only bounded structured actions", () => {
  const request = buildBrowserRequest({
    goal: "inspect the visible page",
    observation: {
      url: "https://example.test",
      visible_text: "Visible content",
      scroll: { up: false, down: true },
      targets: [{ id: "submit", name: "Submit", role: "button", clickable: true }, { id: "country", name: "Country", options: [{ id: "de", label: "Germany" }] }],
      tabs: [{ id: "tab-1", title: "Current", active: true }, { id: "tab-2", title: "Other", active: false }],
    },
  });
  assert.ok(request.capabilities.some((candidate) => candidate.id === "browser:scroll:down"));
  assert.ok(request.capabilities.some((candidate) => candidate.id === "browser:click:submit"));
  assert.ok(request.capabilities.some((candidate) => candidate.id === "browser:select:country:de"));
  assert.ok(request.capabilities.some((candidate) => candidate.id === "browser:switch_tab:tab-2"));
  assert.ok(request.capabilities.every((candidate) => candidate.permissions.includes("browser")));
  assert.equal(request.capabilities.some((candidate) => candidate.id.includes("type")), false);
});

test("browser progress removes completed targets and exposes link navigation", () => {
  const request = buildBrowserRequest({
    goal: "click the action then navigate",
    observation: {
      url: "https://example.test/start",
      targets: [
        { id: "action", role: "button", name: "Action", clickable: true },
        { id: "next", role: "a", name: "Next", href: "/next", clickable: true },
      ],
    },
    progress: {
      executed_actions: [{ id: "browser:click:action", operation: "click", target_id: "action", status: "completed" }],
      used_targets: ["action"],
      current_url: "https://example.test/start",
      last_action: { id: "browser:click:action", operation: "click", target_id: "action", status: "completed" },
      last_result: { status: "completed", state_changed: true },
    },
  });
  assert.equal(request.capabilities.some((candidate) => candidate.id === "browser:click:action"), false);
  assert.ok(request.capabilities.some((candidate) => candidate.id === "browser:navigate:https%3A%2F%2Fexample.test%2Fnext:next"));
  assert.equal(request.context.browser.progress.goal, "click the action then navigate");
  assert.equal(request.context.browser.progress.current_url, "https://example.test/start");
  assert.equal(request.context.browser.progress.last_action.target_id, "action");
});

test("browser progress infers actionable roles and deterministic goal order", () => {
  const request = buildBrowserRequest({
    goal: "Click Increment, then select Beta, then navigate to the next page",
    observation: {
      url: "https://example.test/start",
      targets: [
        { id: "increment", role: "button", name: "Increment" },
        { id: "choice", role: "select", name: "Choice", options: [{ id: "beta", value: "beta", label: "Beta" }] },
        { id: "next", role: "a", name: "Next", href: "/next" },
      ],
    },
  });
  assert.deepEqual(request.context.browser.progress.remaining_expected_progress, [
    "browser:click:increment",
    "browser:select:choice:beta",
    "browser:navigate:https%3A%2F%2Fexample.test%2Fnext:next",
  ]);
  assert.deepEqual(request.capabilities.map((candidate) => candidate.id), ["browser:click:increment", "browser:handoff"]);
});

test("browser progress only permits repeated scroll after measurable progress", () => {
  const base = {
    goal: "scroll down",
    observation: { url: "https://example.test", scroll: { down: true, position: 100, max: 1000 } },
  };
  const blocked = browserActions({
    ...base,
    progress: {
      last_action: { id: "browser:scroll:down", operation: "scroll", direction: "down", status: "completed" },
      last_result: { status: "completed", state_changed: false, scroll_progress: false },
    },
  });
  assert.equal(blocked.some((candidate) => candidate.id === "browser:scroll:down"), false);
  const allowed = browserActions({
    ...base,
    progress: {
      last_action: { id: "browser:scroll:down", operation: "scroll", direction: "down", status: "completed" },
      last_result: { status: "completed", state_changed: true, scroll_progress: true },
    },
  });
  assert.ok(allowed.some((candidate) => candidate.id === "browser:scroll:down"));
});

test("browser fast-path is opt-in and fails open without an executor", async () => {
  const disabled = await decideBrowserStep({ goal: "inspect", observation: {} }, { enabled: false, provider: "demo" });
  assert.equal(disabled.decision.status, "fallback");
  assert.equal(disabled.decision.fallback.type, "browser_fast_path_disabled");
  const unavailable = await runBrowserFastPath({ goal: "inspect", enabled: true, provider: "demo" });
  assert.equal(unavailable.status, "handoff");
  assert.equal(unavailable.reason, "browser_executor_unavailable");
});

test("browser fast-path executes safe actions then hands control back", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "jev-browser-")), "cases.jsonl");
  const executed = [];
  const observations = [
    { url: "https://example.test", scroll: { up: false, down: true }, tabs: [{ id: "tab-1", active: true }, { id: "tab-2", title: "Other", active: false }] },
    { url: "https://example.test", scroll: { up: false, down: false }, tabs: [{ id: "tab-1", active: true }, { id: "tab-2", title: "Other", active: false }] },
  ];
  const executor = {
    async observe() { return observations.shift() ?? observations.at(-1) ?? {}; },
    async execute(action) {
      executed.push(action);
      return { result: { operation: action.operation }, observation: observations.shift() ?? {}, handoff: executed.length === 2 };
    },
  };
  const result = await runBrowserFastPath({
    goal: "scroll and switch to the other tab",
    harness: "browser-test",
    enabled: true,
    provider: providerFor(["browser:scroll:down", "browser:switch_tab:tab-2"]),
    executor,
    receiptPath: path,
  });
  assert.equal(result.status, "handoff");
  assert.equal(result.reason, "host_handoff");
  assert.deepEqual(executed.map((action) => action.operation), ["scroll", "switch_tab"]);
  assert.equal(result.metrics.jev_calls, 2);
  assert.equal(result.metrics.browser_actions, 2);
  assert.equal(result.metrics.failures, 0);
  assert.equal(result.metrics.cost_usd, 0.0002);
  const records = (await readFile(path, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.length, 4);
  assert.equal(records.filter((record) => record.record_type === "routing_case").length, 2);
  assert.equal(records.filter((record) => record.record_type === "execution_receipt").length, 2);
  assert.equal(records[1].host.browser.operation, "scroll");
  assert.equal(records[3].host.browser.operation, "switch_tab");
  const replayCases = await readRoutingCases(path);
  const replayed = await Promise.all(replayCases.map((routingCase) => routeRequest(routingCase.request, { provider: "demo" })));
  assert.equal(replayed.length, 2);
  assert.ok(replayed.every((decision) => decision.execution.enabled === false));
});

test("consequential browser action hands off for host approval", async () => {
  let executeCalls = 0;
  const result = await runBrowserFastPath({
    goal: "click the visible action",
    enabled: true,
    provider: providerFor(["browser:click:action"]),
    executor: {
      async observe() { return { targets: [{ id: "action", name: "Action", clickable: true }] }; },
      async approve() { return false; },
      async execute() { executeCalls += 1; return {}; },
    },
  });
  assert.equal(result.status, "handoff");
  assert.equal(result.reason, "host_confirmation_required");
  assert.equal(executeCalls, 0);
});

test("native select uses the optional host select executor", async () => {
  let selectCalls = 0;
  let executeCalls = 0;
  const result = await runBrowserFastPath({
    goal: "select beta",
    enabled: true,
    maxSteps: 1,
    provider: providerFor(["browser:select:choice:beta"]),
    executor: {
      async observe() { return { targets: [{ id: "choice", role: "select", options: [{ id: "beta", label: "Beta" }] }] }; },
      async approve() { return true; },
      async select(action) { selectCalls += 1; return { result: { value: action.option_id }, observation: { targets: [] } }; },
      async execute() { executeCalls += 1; },
    },
  });
  assert.equal(result.reason, "browser_step_budget_exhausted");
  assert.equal(result.metrics.browser_actions, 1);
  assert.equal(selectCalls, 1);
  assert.equal(executeCalls, 0);
});
