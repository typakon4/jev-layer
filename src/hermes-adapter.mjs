#!/usr/bin/env node
/**
 * One-shot transport used by the Hermes plugin.
 *
 * This is deliberately an adapter, not an executor: it accepts a closed host
 * request and returns bounded Jev decisions/receipts. Native Hermes retains
 * registry lookup, approvals, execution, retries, recovery, and final output.
 */
import { createInterface } from "node:readline";
import { decideBrowserStep } from "./browser.mjs";
import { configuredProvider, configuredReplayPath, loadConfig } from "./config.mjs";
import { appendExecutionReceipt, appendRoutingCase, buildExecutionReceipt, replayCasePath } from "./receipts.mjs";
import { routeRequest } from "./route.mjs";
import { superviseWork } from "./supervision.mjs";

const { config } = await loadConfig();
const casesPath = replayCasePath(configuredReplayPath(config));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const envelope = JSON.parse(line);
    const result = await handle(envelope);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(fallback(error))}\n`);
  }
}

async function handle({ operation, args = {}, decision = null } = {}) {
  const provider = configuredProvider(config, args.provider);
  if (operation === "route") {
    const { provider: _provider, engine = "native", ...request } = args;
    const result = await routeRequest(request, {
      provider,
      engine,
      contextFilterMode: request.policy?.context_filter_mode ?? config.features?.context_filter,
    });
    await persistRoutingCase(request, result);
    return result;
  }
  if (operation === "browser_step") {
    const { provider: _provider, enabled, ...input } = args;
    const routed = await decideBrowserStep(input, {
      enabled: enabled ?? config.features?.browser_fast_path,
      provider,
    });
    routed.decision.browser_action = routed.action
      ? { id: routed.action.id, operation: routed.action.operation, target_id: routed.action.target_id ?? null,
          option_id: routed.action.option_id ?? null, consequential: routed.action.consequential }
      : null;
    await persistRoutingCase(routed.request, routed.decision);
    return routed.decision;
  }
  if (operation === "supervise") {
    const { provider: _provider, enabled, ...input } = args;
    return superviseWork({
      ...input,
      enabled: enabled ?? config.features?.supervision,
      provider,
      receiptPath: casesPath,
    });
  }
  if (operation === "record_execution") {
    if (!decision || typeof decision !== "object") throw new TypeError("decision is required for record_execution");
    if (args.correlation_id !== decision.correlation_id) throw new TypeError("correlation_id does not match the routed decision");
    try {
      const { record } = await appendExecutionReceipt({ path: casesPath, request: decision._jev_request ?? {}, decision, host: args });
      return record;
    } catch (error) {
      const record = buildExecutionReceipt({ request: decision._jev_request ?? {}, decision, host: args });
      return { ...record, persistence: { persisted: false, error: error instanceof Error ? error.message : String(error) } };
    }
  }
  throw new TypeError(`unsupported Hermes adapter operation: ${operation}`);
}

async function persistRoutingCase(request, decision) {
  decision._jev_request = request;
  try {
    await appendRoutingCase({ path: casesPath, request, decision });
    decision.receipt = { ...decision.receipt, replay_case_id: decision.correlation_id, replay_persisted: true };
  } catch (error) {
    decision.receipt = { ...decision.receipt, replay_persisted: false,
      replay_error: error instanceof Error ? error.message : String(error) };
  }
}

function fallback(error) {
  const reason = error instanceof Error ? error.message : String(error);
  return { schema_version: 1, status: "fallback", selected: null, reason,
    fallback: { type: "adapter_error", reason }, execution: { enabled: false, status: "not_started" } };
}
