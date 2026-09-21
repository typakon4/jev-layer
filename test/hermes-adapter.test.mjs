import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const adapter = new URL("../src/hermes-adapter.mjs", import.meta.url).pathname;

function run(lines, replayPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [adapter], { env: { ...process.env, JEV_REPLAY_CASES: replayPath } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `adapter exited ${code}`));
      resolve(out.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
    });
    child.stdin.end(lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  });
}

test("Hermes adapter routes a closed candidate set and records a correlated receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-hermes-adapter-"));
  const replayPath = join(dir, "cases.jsonl");
  const routeRequest = { operation: "route", args: { harness: "hermes-test", intent: "Read a source file", provider: "demo", actor_permissions: ["read"], capabilities: [
    { id: "read", kind: "tool", name: "Read file", description: "Read a local text file", permissions: ["read"], risk: "low", available: true },
    { id: "write", kind: "tool", name: "Write file", description: "Mutate a local file", permissions: ["write"], risk: "high", available: true },
  ] } };
  const [decision] = await run([routeRequest], replayPath);
  assert.equal(decision.status, "selected");
  assert.equal(decision.selected, "read");
  assert.ok(decision.correlation_id);
  assert.ok(decision._jev_request);
  const [receipt] = await run([{ operation: "record_execution", decision, args: { correlation_id: decision.correlation_id, harness: "hermes-test", capability_id: "read", status: "completed", result: { lines: 3 }, duration_ms: 4 } }], replayPath);
  assert.equal(receipt.record_type, "execution_receipt");
  assert.equal(receipt.correlation_id, decision.correlation_id);
  assert.equal(receipt.host.status, "completed");
  const records = (await readFile(replayPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(records.filter((record) => record.record_type === "routing_case").length, 1);
  assert.equal(records.filter((record) => record.record_type === "execution_receipt").length, 1);
});

test("Hermes adapter exposes supervision and browser surfaces without execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-hermes-adapter-"));
  const replayPath = join(dir, "cases.jsonl");
  const [supervision, browser] = await run([
    { operation: "supervise", args: { provider: "demo", enabled: true, harness: "hermes-test", job: { goal: "verify" }, observation: { state: "done" }, evidence: { tests_passed: true } } },
    { operation: "browser_step", args: { provider: "demo", enabled: true, harness: "hermes-test", goal: "Open the visible docs link", observation: { url: "https://example.test", targets: [{ id: "docs", name: "Docs", href: "/docs", visible: true, clickable: true }], tabs: [], scroll: { down: false, up: false } } } },
  ], replayPath);
  assert.equal(supervision.status, "judged");
  assert.ok(["continue", "verify", "retry", "finish", "escalate"].includes(supervision.action));
  assert.ok(["selected", "fallback", "no_decision", "needs_confirmation"].includes(browser.status));
  assert.equal(browser.execution.enabled, false);
});
