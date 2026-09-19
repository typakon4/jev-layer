# Contributing to jev-layer

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

jev-layer is a portable System-1 decision layer. Contributions must preserve the rule that the host owns execution, permissions, approvals, retries, recovery, and final results. Jev returns bounded decisions; it does not become a security boundary or a second executor.

## Before opening a pull request

1. Read `SECURITY.md` and `docs/SCHEMA-VERSIONING.md`.
2. Keep the change narrow. Do not add runtime features while changing an adapter or documentation.
3. Add deterministic tests and an offline fixture. Provider-backed tests are optional and must not require secrets in ordinary CI.
4. Do not commit API keys, tokens, private keys, `.env` files, machine-specific paths, home directories, or local installation state.
5. Preserve existing schema v1 fields and fail-open behavior unless a versioned migration is part of the change.

## Adapter contract (version 1)

A harness adapter is a thin integration. It may use the CLI or stdio MCP, but it must preserve the following sequence:

| Stage | Required behavior |
| --- | --- |
| Capability discovery/input | Build a closed `capabilities[]` set from the host's known capabilities. Include stable `id`, `kind`, `name`, `description`, `permissions`, `risk`, and availability metadata where known. Do not ask Jev to discover or execute hidden host tools. |
| `jev_route` call | Send `schema_version: 1`, `harness`, `intent`, bounded `context`, `actor_permissions`, `capabilities`, and `policy` to `jev_route`. Preserve the returned `correlation_id` and selected capability id. |
| Host execution | Resolve the selected id through the harness's native registry. The adapter must not shell out to arbitrary ids, grant permissions, or replace native tool execution. |
| `jev_record_execution` receipt | After the host decides what happened, call `jev_record_execution` with the same `correlation_id`, `status` (`completed`, `failed`, or `not_started`), `capability_id`, bounded result/error, and optional exit/timing metadata. |
| Fail-open | If Jev is disabled, unavailable, times out, returns an error, or returns no usable selection, continue through the harness's normal native path. Never guess a capability or treat a Jev failure as permission to execute. |
| Approval semantics | The host remains the approval authority. Consequential actions require the host's normal approval before execution. A denial records `not_started`; Jev cannot approve, elevate, retry, or override the host. |

`jev_browser_step` follows the same ownership rule: the host supplies a structured observation, the host approves consequential browser actions, and the host executes or hands control back. It is experimental and opt-in.

### Minimal adapter pseudocode

```text
request = {
  schema_version: 1,
  harness: "my-harness",
  intent: host_goal,
  context: bounded_host_context,
  actor_permissions: host_permissions,
  capabilities: host_capabilities,
  policy: host_policy
}

decision = call_jev_route(request)

if decision.status != "selected" or decision.selected is null:
    return native_host_path(request)

if consequential(decision.selected) and not host_approval(decision.selected):
    call_jev_record_execution({
      correlation_id: decision.correlation_id,
      capability_id: decision.selected,
      status: "not_started",
      error: "host approval denied"
    })
    return native_host_path(request)

try:
    host_result = execute_native(decision.selected)
    status = "completed"
except error:
    host_result = null
    status = "failed"

receipt = call_jev_record_execution({
  correlation_id: decision.correlation_id,
  capability_id: decision.selected,
  status,
  result: bounded(host_result),
  error: bounded(error),
  duration_ms: measured_duration
})
return { decision, host_result, receipt }
```

Copy `integrations/template/adapter.mjs` for a small JavaScript starting point with the same injected boundaries.

## Adding a new harness

The shortest supported PR path is:

1. Add `integrations/<harness>/` with a thin adapter that calls the existing CLI or MCP contract.
2. Add a secret-free config/example snippet under `config/` or the integration directory.
3. Add an offline smoke fixture proving route, fail-open, approval denial, host execution, and execution receipt behavior.
4. Register compatibility in `README.md`, the translated READMEs, `docs/SCHEMA-VERSIONING.md`, and `RELEASE.md` when the harness is supported.
5. Run the required CI commands and submit the PR.

Do not add a harness-specific routing implementation. Keep configuration user-owned; never overwrite global harness settings.

## Adding a provider

Providers implement the existing provider surface in `src/providers/`: a `name` and an async `decide({ state, candidates })` method. Supervision-capable providers may also implement `evaluate({ state, questions })`. Return the normalized provider response expected by `src/route.mjs`; do not execute capabilities in the provider.

- Add the provider to explicit configuration/selection only when it is usable offline or clearly fails open.
- Add deterministic unit tests using injected responses or the `demo` provider.
- Keep API keys and endpoints in environment variables or user-owned configuration.
- Provider-backed tests belong in secret-managed CI, not ordinary pull-request CI.

## Adding a discovery source

Use `discoverCapabilities()` and the normalized capability shape in `src/discovery.mjs`. A new source must:

- produce stable, namespaced ids;
- preserve `kind`, `name`, `description`, `source`, `verified`, and availability metadata;
- deduplicate by id deterministically;
- read only explicit input or an explicitly supplied manifest path;
- never scan undocumented global locations or execute discovered entries.

Add a fixture covering empty input, malformed entries, duplicate ids, unavailable entries, and the new source's normalized output.

## Adding a browser executor

Browser executors are host-owned and optional. Implement `observe()` plus `execute(action)`, and implement `select(action)` when the host has a native select mechanism. The observation must be bounded and structured; the executor must validate target ids, preserve host approval, return the next observation, and report failures without retrying implicitly. Do not add screenshots, text entry, browser workers, or permission logic to jev-layer as part of an executor contribution.

## Adding an eval or replay fixture

Add a small JSONL or JSON fixture under `examples/` or a test fixture directory. Include a stable `schema_version`, `harness`, bounded capabilities, and deterministic expected selection/fallback behavior. For receipts, use one `correlation_id` for the routing case and execution receipt. Exercise it with:

```sh
npm run replay:evaluate -- --provider demo --limit 20
npm test
```

A fixture must not call a real provider, host command, network service, or browser. If a real-provider scenario is useful, document it separately and gate it on an explicitly supplied secret.

## Required checks

From a clean checkout:

```sh
npm install
npm test
npm run smoke
npm run fail-open-smoke
npm run clean-install-smoke
npm pack --dry-run
```

Changes touching browser, supervision, context filtering, discovery, or MCP should also run the matching existing E2E/smoke script. CI does not require provider credentials.

## Backward compatibility

- Keep schema v1 request, decision, receipt, and replay fields readable.
- Prefer additive optional fields. Do not rename or remove existing fields in a patch release.
- Preserve `correlation_id` across route and execution records.
- Preserve fail-open behavior and host approval ownership.
- If a breaking contract is unavoidable, document a new schema/adapter version and migration before changing the implementation.
