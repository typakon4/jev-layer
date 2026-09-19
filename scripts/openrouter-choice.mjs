import { routeRequest } from "../src/route.mjs";

const endpoint = process.env.OPENROUTER_DECISIONS_ENDPOINT ?? "https://openrouter.ai/api/alpha/decisions";
const model = process.env.OPENROUTER_DECISIONS_MODEL ?? "typesafe/jev-1.13";
const decision = await routeRequest({
  schema_version: 1,
  harness: "jev-layer-openrouter-smoke",
  intent: "Find where the OpenRouter Decisions provider is implemented without modifying files",
  context: {
    purpose: "one real bounded Choice call",
    secret_note: "must be redacted before provider transmission",
  },
  actor_permissions: ["read", "browser", "terminal:read"],
  capabilities: [
    {
      id: "repo_search",
      kind: "mcp",
      name: "Repository search",
      description: "Search repository files and symbols without changing files",
      permissions: ["read"],
      risk: "low",
    },
    {
      id: "browser_inspect",
      kind: "mcp",
      name: "Browser inspection",
      description: "Open a webpage and inspect visible browser state",
      permissions: ["browser"],
      risk: "medium",
    },
    {
      id: "terminal_read",
      kind: "cli",
      name: "Read-only terminal",
      description: "Run a read-only shell command and return its output",
      permissions: ["terminal:read"],
      risk: "low",
    },
  ],
}, {
  provider: "openrouter",
  openrouter: { endpoint, model, timeoutMs: 15_000 },
});

const raw = decision.raw_jev ?? {};
const usage = raw.usage && typeof raw.usage === "object" ? raw.usage : {};
console.log(JSON.stringify({
  request: { endpoint, model, method: "POST" },
  response: { id: raw.id ?? null, model: raw.model ?? null, provider: raw.provider ?? null },
  status: decision.status,
  selected: decision.selected,
  probabilities: decision.probabilities,
  confidence: decision.confidence,
  latency_ms: decision.receipt.latency_ms,
  cost_usd: typeof usage.cost === "number" ? usage.cost : null,
  usage,
  fallback: decision.fallback,
  execution: decision.execution,
}, null, 2));
