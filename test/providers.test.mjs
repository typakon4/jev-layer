import assert from "node:assert/strict";
import { test } from "node:test";
import { routeRequest } from "../src/route.mjs";

// Keep these offline checks independent of a developer's provider environment.
for (const key of Object.keys(process.env)) {
  if (/^(JEV_|TYPESAFE_|OPENROUTER_)/.test(key)) delete process.env[key];
}

const request = {
  intent: "Search repository files",
  actor_permissions: ["read"],
  capabilities: [
    { id: "search", name: "Repository search", description: "Search repository files", permissions: ["read"], risk: "low" },
    { id: "clock", name: "Clock", description: "Report the current time", permissions: ["read"], risk: "low" },
  ],
};
const answer = { type: "choice", choice: "search", probabilities: { search: 0.9, clock: 0.1 }, confidence: 0.8 };

test("demo routes deterministically without a network call or credentials", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("demo must remain offline"); });
  const first = await routeRequest(request, { provider: "demo" });
  const second = await routeRequest(request, { provider: "demo" });
  assert.equal(first.status, "selected");
  assert.equal(first.selected, "search");
  assert.deepEqual(first.probabilities, second.probabilities);
  assert.equal(first.receipt.provider, "jev-demo");
  assert.equal(first.execution.enabled, false);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

for (const [provider, endpoint, model] of [
  ["typesafe", "https://api.typesafe.ai/v1/systemone", "jev-latest"],
  ["openrouter", "https://openrouter.ai/api/alpha/decisions", "typesafe/jev-1.13"],
]) {
  test(`${provider} routes with the documented endpoint, model, auth and Choice contract`, async () => {
    let calls = 0;
    const decision = await routeRequest(request, {
      provider,
      [provider]: {
        apiKey: "fixture-key",
        httpReferer: "https://example.test",
        appTitle: "Jev fixture",
        async fetchImpl(url, init) {
          calls += 1;
          assert.equal(url, endpoint);
          assert.equal(init.method, "POST");
          assert.equal(init.headers.Authorization, "Bearer fixture-key");
          assert.equal(init.headers["Content-Type"], "application/json");
          assert.ok(init.signal instanceof AbortSignal);
          if (provider === "openrouter") {
            assert.equal(init.headers["HTTP-Referer"], "https://example.test");
            assert.equal(init.headers["X-Title"], "Jev fixture");
          }
          const body = JSON.parse(init.body);
          assert.equal(body.model, model);
          assert.equal(body.state.intent, request.intent);
          assert.equal(body.questions.tool.type, "choice");
          assert.deepEqual(Object.keys(body.questions.tool.criteria), ["search", "clock"]);
          assert.equal(body.questions.tool.criteria.search.description, request.capabilities[0].description);
          assert.equal("messages" in body, false);
          return Response.json({ model, answers: { tool: answer }, usage: { input_tokens: 10, output_tokens: 2 } });
        },
      },
    });
    assert.equal(calls, 1);
    assert.equal(decision.status, "selected");
    assert.equal(decision.selected, "search");
    assert.deepEqual(decision.probabilities, answer.probabilities);
    assert.equal(decision.confidence, answer.confidence);
    assert.deepEqual(decision.execution, { enabled: false, status: "not_started" });
  });

  test(`${provider} never calls HTTP when credentials are missing or routing is deterministic`, async () => {
    let calls = 0;
    const options = { provider, [provider]: { apiKey: "", fetchImpl: async () => { calls += 1; throw new Error("must not call HTTP"); } } };
    const missing = await routeRequest(request, options);
    assert.equal(missing.status, "fallback");
    assert.equal(missing.fallback.type, "provider_error");
    assert.match(missing.reason, /API_KEY is not configured/);
    const deterministic = await routeRequest({ ...request, policy: { deterministic: true, deterministic_capability_id: "search" } }, options);
    assert.equal(deterministic.status, "selected");
    assert.equal(calls, 0);
  });

  for (const status of [401, 422, 429, 529]) {
    test(`${provider} fails open on HTTP ${status} without retries`, async () => {
      let calls = 0;
      const decision = await routeRequest(request, { provider, [provider]: {
        apiKey: "fixture-key",
        async fetchImpl() { calls += 1; return new Response("fixture error", { status }); },
      } });
      assert.equal(calls, 1);
      assert.equal(decision.status, "fallback");
      assert.equal(decision.fallback.type, "provider_error");
      assert.match(decision.reason, new RegExp(`HTTP ${status}`));
      assert.equal(decision.execution.enabled, false);
    });
  }

  for (const [name, response, fallback] of [
    ["invalid JSON", "{", "provider_error"],
    ["missing answers", {}, "provider_error"],
    ["wrong answer type", { answers: { tool: { type: "score" } } }, "malformed_response"],
    ["unknown capability", { answers: { tool: { ...answer, choice: "unknown" } } }, "invalid_selection"],
    ["low confidence", { answers: { tool: { ...answer, confidence: 0.1 } } }, "low_confidence"],
  ]) {
    test(`${provider} fails open on ${name}`, async () => {
      const decision = await routeRequest(request, { provider, [provider]: {
        apiKey: "fixture-key",
        fetchImpl: async () => new Response(typeof response === "string" ? response : JSON.stringify(response)),
      } });
      assert.equal(decision.status, "fallback");
      assert.equal(decision.fallback.type, fallback);
      assert.equal(decision.execution.enabled, false);
    });
  }
}

test("unsupported providers preserve the routing fallback envelope", async () => {
  const decision = await routeRequest(request, { provider: "unknown" });
  assert.equal(decision.status, "fallback");
  assert.equal(decision.fallback.type, "provider_error");
  assert.ok(decision.correlation_id);
  assert.equal(decision.execution.enabled, false);
});
