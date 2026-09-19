import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendExecutionReceipt, appendRoutingCase, readRoutingCases } from "../src/receipts.mjs";
import { routeRequest } from "../src/route.mjs";

const request = {
  harness: "receipt-test",
  intent: "inspect the repository",
  context: { workspace: "test" },
  actor_permissions: ["read"],
  capabilities: [{
    id: "read_repo",
    kind: "tool",
    name: "Read repository",
    description: "Read repository metadata without modifying files",
    permissions: ["read"],
    risk: "low",
  }],
};

test("execution receipt carries one correlation id through host completion", async () => {
  const provider = {
    name: "receipt-test-provider",
    async decide() {
      return {
        answers: {
          tool: {
            type: "choice",
            choice: "read_repo",
            probabilities: { read_repo: 1 },
            confidence: 1,
          },
        },
        usage: { cost: 0.000123 },
      };
    },
  };
  const decision = await routeRequest(request, { provider });
  const path = join(await mkdtemp(join(tmpdir(), "jev-receipts-")), "cases.jsonl");
  await appendRoutingCase({ path, request, decision });
  const completed = await appendExecutionReceipt({
    path,
    request,
    decision,
    host: {
      harness: "receipt-test",
      capability_id: "read_repo",
      status: "completed",
      result: { bytes: 42 },
      exit_status: 0,
      duration_ms: 12.5,
    },
  });

  assert.equal(decision.correlation_id, decision.receipt.correlation_id);
  assert.equal(decision.receipt.cost_usd, 0.000123);
  assert.equal(completed.record.correlation_id, decision.correlation_id);
  assert.equal(completed.record.jev.cost_usd, 0.000123);
  assert.equal(completed.record.host.exit_status, 0);
  assert.equal(completed.record.host.duration_ms, 12.5);
  assert.deepEqual(completed.record.host.result, { bytes: 42 });

  const routingCases = await readRoutingCases(path);
  assert.equal(routingCases.length, 1);
  assert.equal(routingCases[0].case_id, decision.correlation_id);
  const firstRecord = JSON.parse((await readFile(path, "utf8")).split(/\r?\n/)[0]);
  assert.equal(firstRecord.record_type, "routing_case");
});
