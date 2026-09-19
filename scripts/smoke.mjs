import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { routeRequest } from "../src/route.mjs";

const request = JSON.parse(await readFile(new URL("../examples/route-request.json", import.meta.url), "utf8"));
const selected = await routeRequest(request, { provider: "demo" });
assert.equal(selected.status, "selected");
assert.equal(selected.selected, "repo_search");
assert.equal(selected.execution.enabled, false);
assert.equal(selected.execution.status, "not_started");
assert.ok(selected.receipt.context_bytes > 0);
assert.equal(JSON.stringify(selected.raw_jev).includes("must-not-reach-provider"), false);

const unavailable = await routeRequest({
  ...request,
  intent: "Modify a file",
  capabilities: request.capabilities.map((capability) => ({ ...capability, availability: capability.id === "repo_search" ? { available: false, reason: "offline" } : undefined })),
}, { provider: "demo" });
assert.equal(unavailable.status, "no_decision");

const providerFailure = await routeRequest(request, {
  provider: { name: "failing-test-provider", async decide() { throw new Error("synthetic provider failure"); } },
});
assert.equal(providerFailure.status, "fallback");
assert.equal(providerFailure.fallback.type, "provider_error");
assert.equal(providerFailure.execution.enabled, false);

console.log(JSON.stringify({
  ok: true,
  selected: selected.selected,
  unavailable_status: unavailable.status,
  provider_failure: providerFailure.fallback.type,
  execution_started: selected.execution.enabled,
}));
