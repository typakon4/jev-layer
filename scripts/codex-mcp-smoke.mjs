import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runner = resolve(root, "integrations/codex/run-mcp.mjs");
const child = spawn(process.env.JEV_NODE ?? "node", [runner], {
  cwd: root,
  env: {
    ...process.env,
    JEV_LAYER_ROOT: root,
    JEV_LAYER_PROVIDER: "openrouter",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    waiter(message);
  }
});

try {
  const initialized = await request(1, "initialize", {});
  assert.equal(initialized.result.serverInfo.name, "jev-layer");
  await notification("notifications/initialized", {});
  const listed = await request(2, "tools/list", {});
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_route"));

  const response = await request(3, "tools/call", {
    name: "jev_route",
    arguments: {
      intent: "inspect the routing implementation",
      harness: "codex",
      context: { workspace: "jev-layer", operation: "read-only" },
      actor_permissions: ["read"],
      capabilities: [
        {
          id: "read_route",
          name: "read",
          kind: "tool",
          description: "Read src/route.mjs without modifying it.",
          execution: { mode: "host", target: "src/route.mjs" },
          permissions: ["read"],
          risk: "low",
        },
        {
          id: "read_manifest",
          name: "read",
          kind: "tool",
          description: "Read package.json without modifying it.",
          execution: { mode: "host", target: "package.json" },
          permissions: ["read"],
          risk: "low",
        },
      ],
    },
  });
  const decision = response.result.structuredContent;
  assert.equal(decision.status, "selected");
  assert.ok(decision.selected);

  const target = decision.selected === "read_route" ? "src/route.mjs" : "package.json";
  const content = await readFile(resolve(root, target), "utf8");
  console.log(JSON.stringify({
    ok: true,
    transport: "codex-mcp-runner",
    tool: "jev_route",
    decision: {
      selected: decision.selected,
      probabilities: decision.probabilities,
      confidence: decision.confidence,
      status: decision.status,
      latency_ms: decision.receipt?.latency_ms ?? null,
      cost_usd: decision.raw_jev?.usage?.cost ?? null,
      fallback: decision.fallback,
      provider: decision.receipt?.provider ?? null,
    },
    host_execution: {
      mode: "adapter-transport-fixture",
      target,
      bytes: Buffer.byteLength(content),
      note: "Codex CLI model execution was not exercised by this fixture.",
    },
  }, null, 2));
} finally {
  child.kill();
  await new Promise((resolveExit) => child.once("close", resolveExit));
  if (stderr.length > 0) process.stderr.write(stderr.join(""));
}

function request(id, method, params) {
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 15_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolveResponse(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notification(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  return new Promise((resolveNotification) => setImmediate(resolveNotification));
}
