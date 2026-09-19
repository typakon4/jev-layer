# Template harness adapter

Copy `adapter.mjs` to `integrations/<harness>/` and replace the injected callbacks with the harness's native implementations:

- `jevRoute(request)`: call `jev_route` through the existing stdio MCP or CLI boundary;
- `jevRecordExecution(args)`: call `jev_record_execution` with the original `correlation_id`;
- `approve(capabilityId, decision, request)`: delegate to the host's normal approval UI/policy;
- `executeNative(capabilityId, request, decision)`: resolve and execute the id through the host registry.

The template intentionally does not discover arbitrary tools, grant permissions, retry actions, or spawn workers. Jev failures return `native_fallback`; the host should continue its normal path. Copy the template only after adding a harness-specific smoke fixture and compatibility entry.
