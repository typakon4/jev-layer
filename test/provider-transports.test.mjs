import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { routeRequest } from "../src/route.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const request = {
  intent: "Search repository files",
  actor_permissions: ["read"],
  capabilities: [
    { id: "search", name: "Repository search", description: "Search repository files", risk: "low", permissions: ["read"] },
    { id: "clock", name: "Clock", description: "Report the current time", risk: "low", permissions: ["read"] },
  ],
};
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(JEV_|TYPESAFE_|OPENROUTER_)/.test(key)));
const hasPython = spawnSync("python3", ["--version"]).status === 0;

test("provider configuration reaches CLI, MCP and adapters over local HTTP", { timeout: 30_000 }, async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "jev-providers-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const calls = [];
  const server = createServer(async (incoming, outgoing) => {
    let text = "";
    for await (const chunk of incoming) text += chunk;
    const body = JSON.parse(text);
    calls.push({ url: incoming.url, headers: incoming.headers, body });
    if (incoming.url === "/timeout") return;
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      if (question.type === "noul") return [id, { type: "noul", noul: 0.1 }];
      const ids = Object.keys(question.criteria);
      const choice = ids.includes("search") ? "search" : ids[0];
      return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(ids.map((key) => [key, key === choice ? 1 : 0])) }];
    }));
    outgoing.setHeader("Content-Type", "application/json");
    outgoing.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 10, output_tokens: 2 } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(workspace, "config.json");
  const casesPath = join(workspace, "cases.jsonl");
  const env = {
    ...cleanEnv,
    JEV_CONFIG: configPath,
    JEV_REPLAY_CASES: casesPath,
    TYPESAFE_API_KEY: "fixture-typesafe",
    TYPESAFE_ENDPOINT: `${endpoint}/typesafe`,
    TYPESAFE_MODEL: "fixture-typesafe-model",
    OPENROUTER_API_KEY: "fixture-openrouter",
    OPENROUTER_DECISIONS_ENDPOINT: `${endpoint}/openrouter`,
    OPENROUTER_DECISIONS_MODEL: "fixture-openrouter-model",
    JEV_NODE: process.execPath,
    PYTHONDONTWRITEBYTECODE: "1",
  };

  async function run(args, input, overrides = {}, command = process.execPath) {
    const child = spawn(command, args, { cwd: workspace, env: { ...env, ...overrides }, stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(input);
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    return stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  }

  async function cli(payload = request, args = [], overrides = {}) {
    return (await run([join(root, "bin/jev.mjs"), "cli", ...args], JSON.stringify(payload), overrides))[0];
  }

  async function mcp(payload = request, overrides = {}, name = "jev_route") {
    const messages = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: payload } },
    ];
    const responses = await run([join(root, "bin/jev.mjs"), "mcp"], messages.map((message) => JSON.stringify(message)).join("\n") + "\n", overrides);
    assert.equal(responses[0].result.serverInfo.name, "jev-layer");
    assert.equal(responses[1].error, undefined);
    return responses[1].result.structuredContent;
  }

  function selected(decision, provider, before) {
    assert.equal(decision.status, "selected");
    assert.equal(decision.selected, "search");
    assert.ok(decision.correlation_id);
    assert.deepEqual(decision.execution, { enabled: false, status: "not_started" });
    assert.equal(calls.length, before + (provider === "demo" ? 0 : 1));
    if (provider === "demo") return;
    assert.equal(calls.at(-1).url, `/${provider}`);
    assert.equal(calls.at(-1).headers.authorization, `Bearer fixture-${provider}`);
    assert.equal(calls.at(-1).body.model, `fixture-${provider}-model`);
    if (provider === "openrouter") assert.equal(decision.receipt.provider, "openrouter:fixture-openrouter-model");
  }

  for (const provider of ["demo", "openrouter", "typesafe"]) {
    for (const transport of ["cli", "mcp"]) {
      await t.test(`${provider} via ${transport}: explicit selection overrides environment and config`, async () => {
        await writeFile(configPath, JSON.stringify({ provider: "unknown" }));
        const before = calls.length;
        const decision = transport === "cli"
          ? await cli({ ...request, provider }, ["--provider", "unknown"], { JEV_LAYER_PROVIDER: "unknown" })
          : await mcp({ ...request, provider }, { JEV_LAYER_PROVIDER: "unknown" });
        selected(decision, provider, before);
      });
      await t.test(`${provider} via ${transport}: environment overrides config`, async () => {
        await writeFile(configPath, JSON.stringify({ provider: "unknown" }));
        const before = calls.length;
        const decision = transport === "cli"
          ? await cli(request, [], { JEV_LAYER_PROVIDER: provider })
          : await mcp(request, { JEV_LAYER_PROVIDER: provider });
        selected(decision, provider, before);
      });
      await t.test(`${provider} via ${transport}: project configuration`, async () => {
        await writeFile(configPath, JSON.stringify({ provider }));
        const before = calls.length;
        selected(await (transport === "cli" ? cli() : mcp()), provider, before);
      });
    }
    await t.test(`${provider} via CLI flag overrides environment and config`, async () => {
      await writeFile(configPath, JSON.stringify({ provider: "unknown" }));
      const before = calls.length;
      selected(await cli(request, ["--provider", provider], { JEV_LAYER_PROVIDER: "unknown" }), provider, before);
    });
    await t.test(`${provider} remains disabled without HTTP`, async () => {
      const before = calls.length;
      for (const decision of [await cli({ ...request, provider }, [], { JEV_LAYER_ENABLED: "0" }), await mcp({ ...request, provider }, { JEV_LAYER_ENABLED: "0" })]) {
        assert.equal(decision.fallback.type, "disabled");
        assert.equal(decision.execution.enabled, false);
      }
      assert.equal(calls.length, before);
    });
  }

  for (const provider of ["openrouter", "typesafe"]) {
    await writeFile(configPath, JSON.stringify({ provider, providers: { [provider]: {
      api_key_env: "FIXTURE_KEY", endpoint_env: "FIXTURE_ENDPOINT", model_env: "FIXTURE_MODEL",
    } } }));
    const aliases = { FIXTURE_KEY: `fixture-${provider}`, FIXTURE_ENDPOINT: `${endpoint}/${provider}`, FIXTURE_MODEL: `fixture-${provider}-model` };
    const guardedEnv = { ...aliases, TYPESAFE_API_KEY: "", OPENROUTER_API_KEY: "", TYPESAFE_ENDPOINT: `${endpoint}/wrong`, OPENROUTER_DECISIONS_ENDPOINT: `${endpoint}/wrong` };
    for (const transport of ["cli", "mcp"]) {
      await t.test(`${provider} via ${transport}: configured environment variable names`, async () => {
        const before = calls.length;
        selected(await (transport === "cli" ? cli(request, [], guardedEnv) : mcp(request, guardedEnv)), provider, before);
      });
      await t.test(`${provider} via ${transport}: missing configured key fails open`, async () => {
        const before = calls.length;
        const decision = await (transport === "cli" ? cli(request) : mcp());
        assert.equal(decision.fallback.type, "provider_error");
        assert.equal(calls.length, before);
      });
    }
    await t.test(`${provider} configuration reaches MCP supervision and browser decisions`, async () => {
      const before = calls.length;
      const supervised = await mcp({ enabled: true, job: {}, observation: {} }, guardedEnv, "jev_supervise");
      assert.equal(supervised.status, "judged");
      const browser = await mcp({ enabled: true, goal: "Scroll down", observation: { scroll: { down: true } } }, guardedEnv, "jev_browser_step");
      assert.equal(browser.status, "selected");
      assert.equal(browser.selected, "browser:scroll:down");
      assert.equal(browser.execution.enabled, false);
      assert.equal(calls.length, before + 2);
      assert.equal(calls.at(-1).url, `/${provider}`);
    });
    await t.test(`${provider} times out an actual stalled HTTP request`, async () => {
      const decision = await routeRequest(request, { provider, [provider]: { apiKey: "fixture-key", endpoint: `${endpoint}/timeout`, timeoutMs: 50 } });
      assert.equal(decision.fallback.type, "provider_error");
      assert.match(decision.reason, /timed out/);
      assert.equal(decision.execution.enabled, false);
    });

    await t.test(`${provider} project configuration reaches the OMP Node adapter`, async () => {
      const before = calls.length;
      const code = `
        import extension from ${JSON.stringify(new URL("../integrations/omp/extension.js", import.meta.url).href)};
        const field = { optional() { return this; } };
        const zod = { string: () => field, unknown: () => field, array: () => field, object: () => field };
        let tool;
        extension({ zod, registerTool(value) { tool = value; } });
        console.log(JSON.stringify((await tool.execute("fixture", ${JSON.stringify(request)})).details));
      `;
      selected((await run(["--input-type=module", "-e", code], "", guardedEnv))[0], provider, before);
    });
    await t.test(`${provider} project configuration reaches the Hermes adapter`, { skip: !hasPython }, async () => {
      const before = calls.length;
      const code = "import importlib.util, json, pathlib, sys\np = pathlib.Path(sys.argv[1])\nspec = importlib.util.spec_from_file_location('fixture_hermes', p, submodule_search_locations=[str(p.parent)])\nmodule = importlib.util.module_from_spec(spec)\nsys.modules[spec.name] = module\nspec.loader.exec_module(module)\nprint(module.jev_route(json.load(sys.stdin)))";
      selected((await run(["-c", code, join(root, "integrations/hermes/__init__.py")], JSON.stringify(request), guardedEnv, "python3"))[0], provider, before);
    });
  }

  await t.test("MCP persists routing cases with their correlation ids", async () => {
    const records = (await readFile(casesPath, "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(records.some((record) => record.decision?.receipt?.provider === "typesafe"));
    for (const record of records.filter((record) => record.record_type === "routing_case")) {
      assert.equal(record.case_id, record.correlation_id);
    }
  });
});
