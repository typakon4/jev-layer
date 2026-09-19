import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { decideBrowserStep } from "../src/browser.mjs";
import { routeRequest } from "../src/route.mjs";
import { superviseWork } from "../src/supervision.mjs";

const { config } = await loadConfig({ cwd: "/tmp/jev-no-config" });
assert.equal(config.features.browser_fast_path, false);
assert.equal(config.features.supervision, false);
assert.equal(config.features.context_filter, null);

const browser = await decideBrowserStep({ goal: "scroll down", observation: { scroll: { down: true } } }, {
  provider: { name: "must-not-run", async decide() { throw new Error("disabled browser must not call Jev"); } },
});
assert.equal(browser.decision.fallback.type, "browser_fast_path_disabled");

const previousSupervision = process.env.JEV_SUPERVISION;
delete process.env.JEV_SUPERVISION;
try {
  const supervision = await superviseWork({ provider: { async evaluate() { throw new Error("disabled supervision must not call Jev"); } } });
  assert.equal(supervision.fallback.type, "disabled");
} finally {
  if (previousSupervision === undefined) delete process.env.JEV_SUPERVISION;
  else process.env.JEV_SUPERVISION = previousSupervision;
}

let calls = 0;
const route = await routeRequest({
  intent: "inspect",
  context: { messages: ["plain context"] },
  capabilities: [{ id: "inspect", kind: "tool", name: "Inspect", description: "Inspect context", risk: "low" }],
}, {
  provider: { name: "default-route-provider", async decide() {
    calls += 1;
    return { answers: { tool: { type: "choice", choice: "inspect", probabilities: { inspect: 1 }, confidence: 1 } } };
  } },
});
assert.equal(route.status, "selected");
assert.equal(calls, 1);
console.log(JSON.stringify({
  ok: true,
  browser: browser.decision.fallback.type,
  supervision: "disabled",
  context_filter: "disabled",
  default_route_provider_calls: calls,
}, null, 2));
