/*
 * Copy this file to integrations/<your-harness>/adapter.mjs.
 * The three injected functions are the only Jev/host boundaries:
 *   jevRoute(request) -> decision from jev_route
 *   jevRecordExecution(args) -> execution_receipt from jev_record_execution
 *   executeNative(capabilityId, request) -> host-owned result
 */

export function createTemplateAdapter({ jevRoute, jevRecordExecution, executeNative, approve = async () => true }) {
  for (const [name, value] of Object.entries({ jevRoute, jevRecordExecution, executeNative, approve })) {
    if (typeof value !== "function") throw new TypeError(`${name} callback is required`);
  }

  return {
    async run(request) {
      let decision;
      try {
        decision = await jevRoute(request);
      } catch (error) {
        return nativeFallback("jev_unavailable", error);
      }

      if (decision?.status !== "selected" || typeof decision.selected !== "string" || decision.selected === "") {
        return { status: "native_fallback", reason: decision?.reason ?? "no_selection", decision };
      }

      const approval = await approve(decision.selected, decision, request);
      if (!approval) {
        const receipt = await record(jevRecordExecution, {
          correlation_id: decision.correlation_id,
          harness: request.harness,
          capability_id: decision.selected,
          status: "not_started",
          error: "host approval denied",
        });
        return { status: "native_fallback", reason: "host_confirmation_required", decision, receipt };
      }

      const started = Date.now();
      let host;
      try {
        host = await executeNative(decision.selected, request, decision);
      } catch (error) {
        const receipt = await record(jevRecordExecution, {
          correlation_id: decision.correlation_id,
          harness: request.harness,
          capability_id: decision.selected,
          status: "failed",
          error: boundedError(error),
          duration_ms: Date.now() - started,
        });
        return { status: "native_fallback", reason: "host_execution_failed", decision, error: boundedError(error), receipt };
      }

      const receipt = await record(jevRecordExecution, {
        correlation_id: decision.correlation_id,
        harness: request.harness,
        capability_id: decision.selected,
        status: "completed",
        result: host,
        duration_ms: Date.now() - started,
      });
      return { status: "completed", decision, host, receipt };
    },
  };
}

async function record(jevRecordExecution, args) {
  try {
    return await jevRecordExecution(args);
  } catch (error) {
    // Execution ownership stays with the host even if receipt persistence fails.
    return { persisted: false, error: boundedError(error) };
  }
}

function nativeFallback(reason, error) {
  return {
    status: "native_fallback",
    reason,
    error: error ? boundedError(error) : null,
  };
}

function boundedError(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 2_000);
}
