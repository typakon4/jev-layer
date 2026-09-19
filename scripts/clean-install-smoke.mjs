import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = await mkdtemp(join(tmpdir(), "jev-clean-install-"));
const packageRoot = join(stage, "package");
const workspace = join(stage, "workspace");

try {
  await copyDistribution(packageRoot);
  await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: packageRoot, env: process.env });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "clean-install-workspace", private: true }, null, 2) + "\n", "utf8");
  await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", packageRoot], { cwd: workspace, env: process.env });
  await runNode(packageRoot, ["bin/jev.mjs", "install", "--project", workspace]);
  await runNode(packageRoot, ["bin/jev.mjs", "add", "generic", "--project", workspace]);
  const doctor = await runNode(packageRoot, ["bin/jev.mjs", "doctor", "--project", workspace]);
  const doctorReport = JSON.parse(doctor.stdout);
  assert.equal(doctorReport.ok, true);

  const cli = await runJev(workspace, ["cli", "--provider", "demo", "--input", join(packageRoot, "examples", "route-request.json")]);
  const cliDecision = JSON.parse(cli.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(cliDecision.execution.enabled, false);
  assert.ok(cliDecision.correlation_id);

  const genericConfig = JSON.parse(await readFile(join(workspace, ".jev", "adapters", "generic.json"), "utf8"));
  const genericServer = genericConfig.mcpServers.jev;
  assert.deepEqual(genericServer.args, ["mcp"]);
  const mcpEnv = localEnv(workspace);
  const mcp = spawn(genericServer.command, genericServer.args, {
    cwd: workspace,
    env: { ...mcpEnv, JEV_LAYER_PROVIDER: "demo", JEV_REPLAY_CASES: join(workspace, ".jev", "replay", "cases.jsonl") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  const stderr = [];
  let buffer = "";
  mcp.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  mcp.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    for (const line of buffer.split(/\r?\n/).slice(0, -1)) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
    buffer = buffer.split(/\r?\n/).at(-1) ?? "";
  });

  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = nextId++;
    pending.set(id, resolveRequest);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout waiting for ${method}`));
    }, 10_000).unref();
  });
  const notify = (method, params) => mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

  const initialized = await request("initialize", {});
  assert.equal(initialized.result.serverInfo.name, "jev-layer");
  notify("notifications/initialized", {});
  const listed = await request("tools/list", {});
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_route"));
  assert.ok(listed.result.tools.some((tool) => tool.name === "jev_record_execution"));
  const routed = await request("tools/call", {
    name: "jev_route",
    arguments: {
      harness: "clean-install",
      intent: "read the installed package manifest",
      actor_permissions: ["read"],
      capabilities: [{
        id: "read_manifest",
        kind: "tool",
        name: "Read package manifest",
        description: "Read package.json without changing files",
        permissions: ["read"],
        risk: "low",
      }],
    },
  });
  const decision = routed.result.structuredContent;
  assert.equal(decision.status, "selected");
  const hostResult = await readFile(join(packageRoot, "package.json"), "utf8");
  const recorded = await request("tools/call", {
    name: "jev_record_execution",
    arguments: {
      correlation_id: decision.correlation_id,
      harness: "clean-install",
      capability_id: decision.selected,
      status: "completed",
      result: { bytes: Buffer.byteLength(hostResult) },
      exit_status: 0,
      duration_ms: 1,
    },
  });
  const receipt = recorded.result.structuredContent;
  assert.equal(receipt.correlation_id, decision.correlation_id);
  assert.equal(receipt.host.exit_status, 0);
  assert.equal(receipt.host.duration_ms, 1);
  mcp.stdin.end();
  await onceExit(mcp);
  assert.equal(stderr.join(""), "");

  const records = (await readFile(join(workspace, ".jev", "replay", "cases.jsonl"), "utf8"))
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.record_type), ["routing_case", "execution_receipt"]);
  assert.equal(records[0].correlation_id, records[1].correlation_id);
  const replay = await runNode(packageRoot, ["scripts/replay-eval.mjs", "--provider", "demo", "--input", join(workspace, ".jev", "replay", "cases.jsonl"), "--limit", "1"]);
  const replayReport = JSON.parse(replay.stdout);
  assert.equal(replayReport.replayed_cases, 1);
  assert.equal(replayReport.host_execution_calls, 0);
  console.log(JSON.stringify({
    ok: true,
    stage,
    package_root: packageRoot,
    workspace,
    install: "npm install",
    cli: { status: cliDecision.status, correlation_id: cliDecision.correlation_id },
    mcp: { tools: listed.result.tools.map((tool) => tool.name), selected: decision.selected, host_exit_status: receipt.host.exit_status },
    receipts: records.length,
    replay_cases: records.filter((record) => record.record_type === "routing_case").length,
    replay: { replayed_cases: replayReport.replayed_cases, host_execution_calls: replayReport.host_execution_calls },
  }, null, 2));
} finally {
  await rm(stage, { recursive: true, force: true });
}

async function copyDistribution(destination) {
  const entries = ["bin", "config", "examples", "integrations", "scripts", "src", "test", "README.md", "package.json", "package-lock.json"];
  for (const entry of entries) await cp(join(sourceRoot, entry), join(destination, entry), { recursive: true });
}

function runNode(cwd, args) {
  return execFileAsync(process.execPath, args, { cwd, env: process.env, maxBuffer: 2 * 1024 * 1024 });
}

function runJev(cwd, args) {
  return execFileAsync("jev", args, { cwd, env: localEnv(cwd), maxBuffer: 2 * 1024 * 1024 });
}

function localEnv(workspaceRoot) {
  return {
    ...process.env,
    PATH: `${join(workspaceRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
  };
}

function onceExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveExit() : reject(new Error(`MCP exited with ${code}`)));
  });
}
