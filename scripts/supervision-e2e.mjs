import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { deterministicSupervisionPolicy } from "../src/supervision.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesPath = join(await mkdtemp(join(tmpdir(), "jev-supervision-e2e-")), "cases.jsonl");
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
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_supervise"));

  const disabled = await request(3, "tools/call", {
    name: "jev_supervise",
    arguments: { enabled: false, provider: "demo", job: {}, observation: {} },
  });
  assert.equal(disabled.result.structuredContent.fallback.type, "disabled");

  const judged = await request(4, "tools/call", {
    name: "jev_supervise",
    arguments: {
      enabled: true,
      provider: process.env.JEV_SUPERVISION_PROVIDER ?? "demo",
      harness: "supervision-e2e",
      job: { requirements: ["run tests", "inspect receipts"] },
      observation: { status: "ready", progress: "complete" },
      evidence: {
        tests_passed: true,
        judgments: {
          requirements_addressed: 0.9,
          verification_needed: 0.1,
          meaningful_progress: 0.9,
          worker_stuck: 0.05,
          work_off_track: 0.05,
          completion: 0.9,
        },
      },
    },
  });
  const result = judged.result.structuredContent;
  assert.equal(result.status, "judged");
  assert.equal(result.action, "finish");
  assert.equal(result.metrics.jev_calls, 1);
  assert.ok(result.receipt.correlation_id);

  const records = (await readFile(casesPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.record_type), ["supervision_case"]);
  assert.equal(records[0].supervision.action, "finish");
  const replayed = deterministicSupervisionPolicy({
    assessment: records[0].supervision.assessment,
    evidence: records[0].request.context.evidence,
  });
  assert.equal(replayed.action, records[0].supervision.action);
  console.log(JSON.stringify({
    ok: true,
    cases_path: casesPath,
    action: result.action,
    status: result.status,
    dimensions: Object.keys(result.assessment).length,
    latency_ms: result.receipt.latency_ms,
    cost_usd: result.receipt.cost_usd,
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
