import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  deterministicSupervisionPolicy,
  normalizeAssessment,
  superviseWork,
  supervisionQuestions,
} from "../src/supervision.mjs";
import { readSupervisionCases } from "../src/receipts.mjs";

function assessment(overrides = {}) {
  return {
    requirements_addressed: 0.8,
    verification_needed: 0.1,
    meaningful_progress: 0.8,
    worker_stuck: 0.1,
    work_off_track: 0.1,
    completion: 0.8,
    ...overrides,
  };
}

test("supervision contract exposes bounded dimensions and parses Noul answers", () => {
  assert.deepEqual(Object.keys(supervisionQuestions()), [
    "requirements_addressed",
    "verification_needed",
    "meaningful_progress",
    "worker_stuck",
    "work_off_track",
    "completion",
  ]);
  const parsed = normalizeAssessment({
    answers: {
      requirements_addressed: { type: "noul", probability: 0.8 },
      verification_needed: { type: "noul", p_true: 0.2 },
      meaningful_progress: { type: "noul", score: 0.7 },
      worker_stuck: true,
      work_off_track: 0.1,
      completion: { type: "noul", noul: 0.9 },
    },
  });
  assert.deepEqual(parsed, {
    requirements_addressed: 0.8,
    verification_needed: 0.2,
    meaningful_progress: 0.7,
    worker_stuck: 1,
    work_off_track: 0.1,
    completion: 0.9,
  });
});

test("deterministic host policy owns the supervision action", () => {
  assert.equal(deterministicSupervisionPolicy({ assessment: assessment({ verification_needed: 0.9 }) }).action, "verify");
  assert.equal(deterministicSupervisionPolicy({ assessment: assessment({ worker_stuck: 0.9 }), attempts: 0 }).action, "retry");
  assert.equal(deterministicSupervisionPolicy({ assessment: assessment({ worker_stuck: 0.9 }), attempts: 2 }).action, "escalate");
  assert.equal(deterministicSupervisionPolicy({ assessment: assessment(), evidence: { tests_passed: true } }).action, "finish");
});

test("supervision is opt-in, fail-open, and records replayable judgments", async () => {
  const disabled = await superviseWork({ enabled: false, provider: { async evaluate() { throw new Error("must not call"); } } });
  assert.equal(disabled.status, "fallback");
  assert.equal(disabled.action, "continue");
  assert.equal(disabled.fallback.type, "disabled");

  const directory = await mkdtemp(join(tmpdir(), "jev-supervision-test-"));
  const path = join(directory, "cases.jsonl");
  let calls = 0;
  const result = await superviseWork({
    enabled: true,
    harness: "supervision-test",
    job: { requirements: ["run tests"] },
    observation: { status: "ready" },
    evidence: { tests_passed: true },
    provider: {
      name: "injected-supervision",
      async evaluate({ questions }) {
        calls += 1;
        return {
          answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: "noul", probability: assessment()[key] }])),
          usage: { cost: 0.0003 },
        };
      },
    },
    receiptPath: path,
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "judged");
  assert.equal(result.action, "finish");
  assert.equal(result.metrics.jev_calls, 1);
  assert.equal(result.metrics.cost_usd, 0.0003);
  const cases = await readSupervisionCases(path);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].record_type, "supervision_case");
  assert.equal(cases[0].supervision.action, "finish");
  assert.equal(JSON.parse(await readFile(path, "utf8")).record_type, "supervision_case");
});
