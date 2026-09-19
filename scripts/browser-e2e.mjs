import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesPath = join(await mkdtemp(join(tmpdir(), "jev-browser-e2e-")), "cases.jsonl");
const child = spawn(process.env.JEV_NODE ?? "node", [resolve(root, "src/mcp-server.mjs")], {
  cwd: root,
  env: { ...process.env, JEV_BROWSER_FAST_PATH: "1", JEV_REPLAY_CASES: casesPath },
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
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_browser_step"));

  const routed = await request(3, "tools/call", {
    name: "jev_browser_step",
    arguments: {
      provider: process.env.JEV_BROWSER_PROVIDER ?? "demo",
      enabled: true,
      harness: "browser-e2e",
      goal: "scroll the page downward",
      observation: {
        url: "https://example.test",
        title: "Fixture",
        visible_text: "Additional content is below the fold",
        scroll: { up: false, down: true },
        targets: [],
        tabs: [],
      },
      policy: { min_confidence: 0 },
    },
  });
  const decision = routed.result.structuredContent;
  assert.equal(decision.status, "selected");
  assert.equal(decision.browser_action.operation, "scroll");
  assert.equal(decision.browser_action.target_id, null);

  const started = performance.now();
  const hostResult = { operation: decision.browser_action.operation, direction: "down", fixture: true };
  const recorded = await request(4, "tools/call", {
    name: "jev_record_execution",
    arguments: {
      correlation_id: decision.correlation_id,
      harness: "browser-e2e",
      capability_id: decision.selected,
      status: "completed",
      result: hostResult,
      browser: { operation: "scroll", direction: "down", executed: true },
      exit_status: 0,
      duration_ms: Number((performance.now() - started).toFixed(3)),
    },
  });
  const receipt = recorded.result.structuredContent;
  assert.equal(receipt.correlation_id, decision.correlation_id);
  assert.equal(receipt.host.browser.operation, "scroll");
  assert.equal(receipt.host.exit_status, 0);

  const records = (await readFile(casesPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.record_type), ["routing_case", "execution_receipt"]);
  assert.equal(records[0].request.context.browser.goal, "scroll the page downward");
  console.log(JSON.stringify({
    ok: true,
    cases_path: casesPath,
    decision: {
      correlation_id: decision.correlation_id,
      selected: decision.selected,
      operation: decision.browser_action.operation,
      confidence: decision.confidence,
      latency_ms: decision.receipt.latency_ms,
      cost_usd: decision.receipt.cost_usd ?? null,
    },
    host_execution: { operation: hostResult.operation, exit_status: receipt.host.exit_status },
    receipts: records.length,
  }, null, 2));
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
