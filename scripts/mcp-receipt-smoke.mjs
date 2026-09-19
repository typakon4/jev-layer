import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const root = resolve(new URL("..", import.meta.url).pathname);
const casesPath = join(await mkdtemp(join(tmpdir(), "jev-mcp-receipt-")), "cases.jsonl");
const child = spawn(process.env.JEV_NODE ?? "node", [resolve(root, "src/mcp-server.mjs")], {
  cwd: root,
  env: { ...process.env, JEV_REPLAY_CASES: casesPath },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
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
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_record_execution"));

  const routed = await request(3, "tools/call", {
    name: "jev_route",
    arguments: {
      provider: "demo",
      harness: "mcp-receipt-smoke",
      intent: "read repository metadata",
      actor_permissions: ["read"],
      capabilities: [{
        id: "read_metadata",
        kind: "tool",
        name: "Read metadata",
        description: "Read repository metadata without modifying files",
        permissions: ["read"],
        risk: "low",
      }],
    },
  });
  const decision = routed.result.structuredContent;
  assert.equal(decision.status, "selected");
  assert.equal(decision.receipt.replay_persisted, true);

  const recorded = await request(4, "tools/call", {
    name: "jev_record_execution",
    arguments: {
      correlation_id: decision.correlation_id,
      harness: "mcp-receipt-smoke",
      capability_id: decision.selected,
      status: "completed",
      result: { observed: "metadata" },
      exit_status: 0,
      duration_ms: 3.2,
    },
  });
  const receipt = recorded.result.structuredContent;
  assert.equal(receipt.correlation_id, decision.correlation_id);
  assert.equal(receipt.host.exit_status, 0);
  assert.equal(receipt.host.duration_ms, 3.2);

  const records = (await readFile(casesPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.record_type), ["routing_case", "execution_receipt"]);
  console.log(JSON.stringify({ ok: true, cases_path: casesPath, receipt }, null, 2));
} finally {
  child.kill();
  await new Promise((resolveExit) => child.once("close", resolveExit));
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
