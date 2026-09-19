import { routeRequest } from "../src/route.mjs";

const capabilities = [
  { id: "repo_search", kind: "mcp", name: "Repository search", description: "Search repository files and symbols", permissions: ["read"], risk: "low" },
  { id: "browser_inspect", kind: "mcp", name: "Browser inspection", description: "Open and inspect webpages", permissions: ["browser"], risk: "medium" },
  { id: "terminal_read", kind: "cli", name: "Read-only terminal", description: "Run read-only terminal commands", permissions: ["terminal:read"], risk: "low" },
  { id: "file_write", kind: "tool", name: "File writer", description: "Modify repository files", permissions: ["write"], risk: "high" },
];
const request = {
  harness: "benchmark",
  intent: "Search repository files for the routing implementation",
  context: { workspace: "jev-layer" },
  actor_permissions: ["read"],
  capabilities,
};
const samples = [];
const started = performance.now();
for (let index = 0; index < 1_000; index += 1) {
  const before = performance.now();
  await routeRequest(request, { provider: "demo" });
  samples.push(performance.now() - before);
}
samples.sort((left, right) => left - right);
const percentile = (p) => Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * p))].toFixed(3));
console.log(JSON.stringify({
  provider: "jev-demo",
  iterations: samples.length,
  total_ms: Number((performance.now() - started).toFixed(3)),
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  p99_ms: percentile(0.99),
  provider_calls_per_route: 1,
  host_execution_calls: 0,
  paid_provider_calls: 0,
}));
