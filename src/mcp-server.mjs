#!/usr/bin/env node
import { createInterface } from "node:readline";
import { appendExecutionReceipt, appendRoutingCase, buildExecutionReceipt, replayCasePath } from "./receipts.mjs";
import { configuredProvider, configuredReplayPath, loadConfig } from "./config.mjs";
import { decideBrowserStep } from "./browser.mjs";
import { superviseWork } from "./supervision.mjs";
import { buildShadowCompactionReport } from "./shadow-compaction.mjs";
import { recommendModelRoute } from "./model-routing.mjs";
import { routeRequest } from "./route.mjs";

const { config } = await loadConfig();
const serverInfo = { name: "jev-layer", version: "0.1.0" };
const CASES_PATH = replayCasePath(configuredReplayPath(config));
const pendingDecisions = new Map();
const tools = [
  {
    name: "jev_route",
    description: "Return one bounded Jev capability decision. The host executes the selected capability; this tool never executes it.",
    inputSchema: {
      type: "object",
      required: ["intent", "capabilities"],
      properties: {
        intent: { type: "string" },
        harness: { type: "string" },
        context: { type: "object" },
        actor_permissions: { type: "array", items: { type: "string" } },
        capabilities: { type: "array", items: { type: "object" } },
        policy: { type: "object" },
        provider: { type: "string", enum: ["demo", "typesafe", "openrouter"] },
        engine: { type: "string", enum: ["native", "jevrouter"] },
      },
    },
  },
  {
    name: "jev_browser_step",
    description: "Choose one bounded browser action from the host's visible observation. The host executes it or hands control back; this tool never drives a browser.",
    inputSchema: {
      type: "object",
      required: ["goal", "observation"],
      properties: {
        goal: { type: "string" },
        harness: { type: "string" },
        start_url: { type: ["string", "null"] },
        observation: { type: "object" },
        policy: { type: "object" },
        provider: { type: "string", enum: ["demo", "typesafe", "openrouter"] },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "jev_supervise",
    description: "Judge bounded work-state dimensions; deterministic host policy returns continue, verify, retry, finish, or escalate.",
    inputSchema: {
      type: "object",
      required: ["job", "observation"],
      properties: {
        job: { type: "object" },
        observation: { type: "object" },
        evidence: { type: "object" },
        harness: { type: "string" },
        actor_permissions: { type: "array", items: { type: "string" } },
        policy: { type: "object" },
        attempts: { type: "integer", minimum: 0 },
        provider: { type: "string", enum: ["demo", "typesafe", "openrouter"] },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "jev_model_route",
    description: "Recommend one host-declared model profile for the next call. This is shadow-only: it never changes provider, model, reasoning, or execution.",
    inputSchema: {
      type: "object",
      required: ["intent", "models"],
      properties: {
        intent: { type: "string" },
        context: { type: "object" },
        models: { type: "array", minItems: 1, items: { type: "object" } },
        harness: { type: "string" },
        policy: { type: "object" },
        provider: { type: "string", enum: ["demo", "typesafe", "openrouter"] },
      },
    },
  },
  {
    name: "jev_shadow_compaction",
    description: "Report conservative Jev keep/drop candidates for host-supplied context. This tool never changes, summarizes, or deletes context.",
    inputSchema: {
      type: "object",
      required: ["intent", "context"],
      properties: {
        intent: { type: "string" },
        context: { type: "object" },
        provider: { type: "string", enum: ["demo", "typesafe", "openrouter"] },
        batch_size: { type: "integer", minimum: 1, maximum: 8 },
        keep_threshold: { type: "number", minimum: 0, maximum: 1 },
        min_confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
  {
    name: "jev_record_execution",
    description: "Attach a host execution result to a Jev decision and persist the unified execution receipt.",
    inputSchema: {
      type: "object",
      required: ["correlation_id", "status"],
      properties: {
        correlation_id: { type: "string" },
        harness: { type: "string" },
        capability_id: { type: "string" },
        status: { type: "string", enum: ["completed", "failed", "not_started"] },
        result: {},
        error: {},
        browser: { type: "object" },
        exit_status: { type: ["integer", "null"] },
        duration_ms: { type: ["number", "null"] },
        started_at: { type: ["string", "null"] },
        completed_at: { type: ["string", "null"] },
      },
    },
  },
];

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const id = message?.id ?? null;
    process.stdout.write(`${JSON.stringify(jsonRpcError(id, -32603, error instanceof Error ? error.message : String(error)))}\n`);
  }
}

async function handle(message) {
  const { id, method, params = {} } = message;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo } };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method !== "tools/call") return jsonRpcError(id, -32601, `method not found: ${method}`);

  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  if (params.name === "jev_route") return route(args, id);
  if (params.name === "jev_browser_step") return browserStep(args, id);
  if (params.name === "jev_supervise") return supervise(args, id);
  if (params.name === "jev_model_route") return modelRoute(args, id);
  if (params.name === "jev_shadow_compaction") return shadowCompaction(args, id);
  if (params.name === "jev_record_execution") return recordExecution(args, id);
  return jsonRpcError(id, -32602, `unknown tool: ${params.name}`);
}

async function route(args, id) {
  const { provider: requestedProvider, engine = "native", ...request } = args;
  const provider = configuredProvider(config, requestedProvider);
  const decision = await routeRequest(request, {
    provider,
    engine,
    config,
    contextFilterMode: request.policy?.context_filter_mode ?? config.features?.context_filter,
  });
  return persistDecision(request, decision, id);
}

async function browserStep(args, id) {
  const { provider: requestedProvider, enabled, ...input } = args;
  const routed = await decideBrowserStep(input, {
    config,
    enabled: enabled ?? config.features?.browser_fast_path,
    provider: configuredProvider(config, requestedProvider),
  });
  routed.decision.browser_action = routed.action
    ? {
        id: routed.action.id,
        operation: routed.action.operation,
        target_id: routed.action.target_id ?? null,
        option_id: routed.action.option_id ?? null,
        consequential: routed.action.consequential,
      }
    : null;
  return persistDecision(routed.request, routed.decision, id);
}

async function supervise(args, id) {
  const { provider: requestedProvider, enabled, ...input } = args;
  const result = await superviseWork({
    ...input,
    config,
    enabled: enabled ?? config.features?.supervision,
    provider: configuredProvider(config, requestedProvider),
    receiptPath: CASES_PATH,
  });
  return toolResult(id, result, false);
}

async function modelRoute(args, id) {
  const { provider: requestedProvider, ...input } = args;
  const result = await recommendModelRoute({
    ...input,
    provider: configuredProvider(config, requestedProvider),
  });
  return toolResult(id, result, false);
}

async function shadowCompaction(args, id) {
  const { provider: requestedProvider, ...input } = args;
  const result = await buildShadowCompactionReport({
    ...input,
    provider: configuredProvider(config, requestedProvider),
  });
  return toolResult(id, result, false);
}

async function persistDecision(request, decision, id) {
  pendingDecisions.set(decision.correlation_id, { request, decision });
  try {
    await appendRoutingCase({ path: CASES_PATH, request, decision });
    decision.receipt = { ...decision.receipt, replay_case_id: decision.correlation_id, replay_persisted: true };
  } catch (error) {
    decision.receipt = {
      ...decision.receipt,
      replay_persisted: false,
      replay_error: error instanceof Error ? error.message : String(error),
    };
  }
  return toolResult(id, decision, decision.status === "error");
}

async function recordExecution(args, id) {
  const correlationId = typeof args.correlation_id === "string" ? args.correlation_id : null;
  const pending = correlationId ? pendingDecisions.get(correlationId) : null;
  if (!pending) return jsonRpcError(id, -32004, `unknown Jev correlation_id: ${correlationId ?? "missing"}`);
  const { request, decision } = pending;
  let record;
  try {
    ({ record } = await appendExecutionReceipt({ path: CASES_PATH, request, decision, host: args }));
  } catch (error) {
    record = buildExecutionReceipt({ request, decision, host: args });
    record.persistence = {
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  pendingDecisions.delete(correlationId);
  return toolResult(id, record, false);
}

function toolResult(id, value, isError) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      isError,
    },
  };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
