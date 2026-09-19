import { runBrowserFastPath } from "../src/browser.mjs";

const iterations = Number(process.env.JEV_BROWSER_BENCHMARK_ITERATIONS ?? 25);
const baseline = [];
const jev = [];

for (let iteration = 0; iteration < iterations; iteration += 1) {
  baseline.push(await runBaseline());
  jev.push(await runJev());
}

const report = {
  ok: true,
  iterations,
  provider: "injected-jev-demo-choice",
  baseline: summarize(baseline),
  jev: summarize(jev),
  delta: {
    wall_time_reduction_percent: percent(mean(baseline, "wall_time_ms"), mean(jev, "wall_time_ms")),
    main_model_turn_reduction: mean(baseline, "main_model_turns") - mean(jev, "main_model_turns"),
    extra_jev_calls: mean(jev, "jev_calls") - mean(baseline, "jev_calls"),
    browser_action_delta: mean(jev, "browser_actions") - mean(baseline, "browser_actions"),
    failure_delta: mean(jev, "failures") - mean(baseline, "failures"),
  },
};
console.log(JSON.stringify(report, null, 2));

async function runBaseline() {
  const started = performance.now();
  const actions = ["scroll", "switch_tab"];
  for (const operation of actions) await Promise.resolve(operation);
  return {
    wall_time_ms: elapsed(started),
    main_model_turns: 2,
    jev_calls: 0,
    browser_actions: actions.length,
    failures: 0,
    cost_usd: 0,
  };
}

async function runJev() {
  let index = 0;
  const choices = ["browser:scroll:down", "browser:switch_tab:tab-2"];
  const result = await runBrowserFastPath({
    goal: "scroll down and switch to the other tab",
    enabled: true,
    provider: {
      name: "browser-benchmark-provider",
      async decide({ candidates }) {
        const requested = choices[index++] ?? "browser:handoff";
        const choice = candidates.some((candidate) => candidate.id === requested)
          ? requested
          : candidates.find((candidate) => candidate.id === "browser:handoff")?.id ?? candidates[0]?.id;
        return {
          answers: { tool: { type: "choice", choice, probabilities: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.id === choice ? 1 : 0])), confidence: 1 } },
          usage: { cost: 0.0001 },
        };
      },
    },
    executor: {
      state: 0,
      async observe() {
        return this.state === 0
          ? { scroll: { up: false, down: true }, tabs: [{ id: "tab-1", active: true }, { id: "tab-2", title: "Other", active: false }] }
          : { scroll: { up: false, down: false }, tabs: [{ id: "tab-1", active: true }, { id: "tab-2", title: "Other", active: false }] };
      },
      async execute() {
        this.state += 1;
        return { observation: await this.observe(), handoff: this.state >= 2 };
      },
    },
    mainModelTurns: 1,
  });
  return result.metrics;
}

function summarize(rows) {
  return Object.fromEntries(["wall_time_ms", "main_model_turns", "jev_calls", "browser_actions", "failures", "cost_usd"].map((key) => [key, mean(rows, key)]));
}

function mean(rows, key) {
  return Number((rows.reduce((sum, row) => sum + row[key], 0) / rows.length).toFixed(3));
}

function percent(before, after) {
  return before ? Number((((before - after) / before) * 100).toFixed(2)) : 0;
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(3));
}
