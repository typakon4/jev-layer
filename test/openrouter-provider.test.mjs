import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRouterDecisionsProvider } from "../src/providers/typesafe.mjs";

const candidates = [{
  id: "search",
  kind: "mcp",
  name: "Repository search",
  description: "Search repository files",
  risk: "low",
}];

test("OpenRouter provider sends Decisions Choice payload, not chat completion payload", async () => {
  let requestUrl;
  let requestInit;
  const provider = new OpenRouterDecisionsProvider({
    apiKey: "test-key",
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
    fetchImpl: async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return new Response(JSON.stringify({
        id: "decision-test",
        model: "typesafe/jev-1.13",
        provider: "TypeSafe",
        answers: {
          tool: {
            type: "choice",
            choice: "search",
            probabilities: { search: 1 },
            confidence: 1,
          },
        },
        usage: { input_tokens: 10, output_tokens: 2, cost: 0.000001 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const raw = await provider.decide({
    state: { intent: "Search repository files" },
    candidates,
  });
  const body = JSON.parse(requestInit.body);
  assert.equal(requestUrl, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(requestInit.method, "POST");
  assert.equal(requestInit.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "typesafe/jev-1.13");
  assert.equal(body.questions.tool.type, "choice");
  assert.equal(body.questions.tool.criteria.search.description, "Search repository files");
  assert.deepEqual(body.state, { intent: "Search repository files" });
  assert.equal("messages" in body, false);
  assert.equal(raw.answers.tool.choice, "search");
  assert.equal(raw.usage.cost, 0.000001);
});
