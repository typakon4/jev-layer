# Agent implementation guide

This is the implementation brief to hand to a coding agent before integrating jev-layer into a harness. It is intentionally operational: inspect the target harness first, preserve host ownership, and prove the fallback path. Do not treat a link to this repository as permission to invent an adapter or change the host's execution model.

## Contract in one paragraph

jev-layer is a **System-1 decision layer**, not an executor, permission system, security boundary, retry loop, or browser worker. The host owns capability discovery, the closed candidate set, permissions, approvals, native execution, retries, recovery, and final output. Jev receives bounded input, returns one bounded decision with a `correlation_id`, and records the host's result. If Jev is disabled, unavailable, invalid, inconclusive, or refused by policy, the host continues through its normal native path.

## Before editing

1. Identify the harness's native capability registry and native execution function.
2. Identify the existing permission and approval checks, especially for consequential actions.
3. Identify the host's normal fallback path and its error/retry boundaries.
4. Read [CONTRIBUTING.md](../CONTRIBUTING.md), [SECURITY.md](../SECURITY.md), and [SCHEMA-VERSIONING.md](SCHEMA-VERSIONING.md).
5. Confirm the harness version and transport: CLI, stdio MCP, or an existing adapter boundary.
6. Write a short integration plan naming the exact adapter entry point and the unchanged host-owned functions.
7. Only then edit the smallest possible adapter/configuration surface.

Do not begin by pasting the repository URL to an agent and asking it to "integrate Jev" without supplying the target harness, its native execution path, and its approval semantics.

## Required data flow

### 1. Build a closed capability set in the host

The host must provide only capabilities it already knows how to execute. Each candidate needs a stable id and enough metadata for bounded selection:

```json
{
  "id": "repo:search",
  "kind": "tool",
  "name": "Search repository",
  "description": "Find text in tracked repository files",
  "permissions": ["read"],
  "risk": "low",
  "available": true
}
```

Do not ask Jev to discover hidden host tools. Do not pass arbitrary shell commands as capability ids. Do not expose a capability that the host cannot validate and execute through its native registry.

### 2. Call `jev_route` with bounded input

Preserve schema version 1 and include the host-owned facts needed for the decision:

```json
{
  "schema_version": 1,
  "harness": "my-harness",
  "intent": "Find the implementation of the routing contract",
  "context": {
    "task": "repository inspection"
  },
  "actor_permissions": ["read"],
  "capabilities": [
    {
      "id": "repo:search",
      "kind": "tool",
      "name": "Search repository",
      "description": "Find text in tracked repository files",
      "permissions": ["read"],
      "risk": "low",
      "available": true
    }
  ],
  "policy": {
    "deterministic": true
  }
}
```

Keep `intent`, `context`, and the candidate set bounded. Do not send credentials, unbounded conversation history, hidden tool descriptions, or machine-specific paths.

### 3. Treat the response as advice, never authorization

A normal decision has this shape:

```json
{
  "schema_version": 1,
  "correlation_id": "decision-id",
  "status": "selected",
  "selected": "repo:search",
  "execution": {
    "enabled": false,
    "status": "not_started"
  }
}
```

The adapter must validate all of the following before execution:

- `status` permits a host action (`selected` is different from `fallback`, `no_decision`, and `needs_confirmation`);
- `selected` is non-null and exactly matches an id in the request's candidate set;
- the candidate is still available and its permissions/risk are acceptable;
- the host's current approval policy allows the action.

Never execute an id returned by Jev as a shell command, import path, URL, or arbitrary function name. Resolve it through the harness's native registry.

### 4. Let the host approve consequential work

Jev cannot approve, elevate, or override the host. For a consequential candidate:

1. pause after the decision;
2. run the host's existing approval flow;
3. if denied, do not execute and record `status: "not_started"`;
4. if approved, execute through the native host path.

The Jev decision does not replace the harness confirmation dialog, policy engine, or permission check.

### 5. Execute only through the native host path

The adapter must not become a second executor. Preserve the host's existing:

- capability lookup;
- permission checks;
- approval prompts;
- process/browser/tool execution;
- retry and recovery behavior;
- result shaping and user-visible output.

Jev returns a decision. The host performs the work.

### 6. Record one receipt with the same correlation id

After the host knows what happened, call `jev_record_execution`:

```json
{
  "correlation_id": "decision-id",
  "harness": "my-harness",
  "capability_id": "repo:search",
  "status": "completed",
  "result": {
    "matches": 3
  },
  "exit_status": 0,
  "duration_ms": 12
}
```

Use the same `correlation_id` from `jev_route`. Use:

- `completed` when native execution finished successfully;
- `failed` when native execution ran and failed;
- `not_started` when approval, policy, or fail-open handling prevented execution.

Bound results and errors before recording them. Never write secrets or full untrusted logs into receipts.

### 7. Preserve fail-open behavior

The following conditions must return control to the host's ordinary path without guessing a capability:

- Jev is disabled by configuration;
- the MCP/CLI process is unavailable or times out;
- the provider returns an error or malformed response;
- the decision is `fallback`, `no_decision`, or otherwise unusable;
- the selected id is not in the closed candidate set;
- permissions or approval reject the action.

A Jev failure is not permission to execute. Do not add an adapter retry loop that changes the host's existing retry semantics.

## Installing and wiring the package

For a published local CLI:

```sh
npm install --global jev-layer
jev init --project /path/to/workspace
jev add generic --project /path/to/workspace
jev doctor --project /path/to/workspace
```

For a stdio MCP server:

```sh
jev mcp
```

The generated generic adapter uses the `jev mcp` command. Keep the adapter configuration in the project/workspace where the harness owns it; do not overwrite global harness configuration. Use `JEV_LAYER_PROVIDER=demo` for offline deterministic development. Keep OpenRouter or TypeSafe credentials in the process environment or another user-owned secret store.

For an existing harness, copy the smallest relevant example from `integrations/` and adapt its transport. Do not copy an integration wholesale without checking the harness's actual registry, approval, and execution APIs.

## Copy-paste handoff for a coding agent

Use this prompt with the guide and the target harness details:

```text
Implement jev-layer as a thin System-1 decision layer in this harness.

Read docs/AGENT-IMPLEMENTATION.md first. Then inspect the harness's native
capability registry, permission checks, approval flow, execution function,
retry/recovery boundaries, and existing MCP/CLI integration point.

Target harness: <name and version>
Target integration point: <file/function/config>
Native execution function: <file/function>
Approval authority: <file/function>
Normal fallback path: <file/function>

Requirements:
- Build a closed capabilities[] set from the host registry.
- Call jev_route with schema_version: 1, bounded intent/context,
  actor_permissions, capabilities, and policy.
- Validate status, selected id, availability, permissions, and approval in
  the host before execution.
- Resolve selected ids through the native registry; never shell out to ids
  returned by Jev and never let Jev execute host work.
- Preserve the existing host fallback path when Jev is disabled, unavailable,
  invalid, inconclusive, or rejected.
- Call jev_record_execution with the same correlation_id after the host knows
  the result.
- Add offline tests for selected execution, fail-open, unknown-id rejection,
  approval denial, and receipt correlation.
- Do not add provider credentials, global config writes, hidden capability
  discovery, arbitrary command execution, or unrelated runtime features.

Before changing code, show the files/symbols you will touch. After changing
code, report the exact native execution path preserved and the verification
commands/results.
```

Replace every `<...>` placeholder with facts from the target harness. Do not leave the agent to infer them from a generic repository link.

## Vision and computer use

Jev 1.14 image input and Box are experimental. Direct `typesafe` is pinned to `jev-1.14.0` and sends the required Images opt-in header. `openrouter` uses `typesafe/jev-1.14` and converts layer assets into inline `image_url` parts. Both support screenshots; live OpenRouter checks verified color perception and screenshot-only Box grounding. See [provider formats, limits and enablement](PROVIDERS.md#images-and-box-questions).

### Browser screenshots

`jev_browser_step` accepts optional `observation.screenshot = { format, data_base64, width, height }` alongside the existing visible text, DOM/accessibility targets, tabs, scroll and progress. Existing structured actions remain authoritative; an image does not invent additional browser capabilities. The host-owned `runBrowserFastPath` also forwards screenshots from `executor.observe()` and subsequent observations.

### Desktop decision

Enable with `features.computer_use: true`, `JEV_COMPUTER_USE=1`, or per-call `enabled: true`. Explicit per-call `enabled: false` wins. Send `jev_computer_step` (MCP) or `computer_step` (Hermes core) this shape:

```json
{
  "provider": "openrouter",
  "enabled": true,
  "goal": "Click the visible Save button",
  "actor_permissions": ["computer"],
  "observation": {
    "application": "Editor",
    "screenshot": {
      "format": "png",
      "data_base64": "<base64 of the host-captured image>",
      "width": 400,
      "height": 300
    }
  },
  "actions": [
    { "id": "save", "operation": "click", "target": "the Save button", "args": {} },
    { "id": "handoff", "operation": "handoff", "args": {} }
  ]
}
```

The screenshot must be a prepared PNG/JPEG within upstream limits; its declared dimensions must match its bytes. No file paths, URLs, implicit screenshot capture or image resizing. Supply at most 32 unique host-owned action ids. The supported argument shapes are:

| Operation | Host-supplied `args` |
| --- | --- |
| `click` | `{ x, y, button? }`, or `{ button? }` plus a unique top-level `target` description |
| `type` | `{ text }`; exact host text, never generated by Jev |
| `key` | `{ keys: ["Control", "S"] }`; exact host key names |
| `scroll` | `{ direction: "up|down|left|right", amount?, x?, y? }` |
| `handoff` | `{ reason? }` |

Availability, additional permissions, risk and confirmation metadata use the existing capability policy. Missing `computer` permission cannot select a desktop action. Click/type/key always return `needs_confirmation`; the layer does not approve or execute them.

For a selected described click, a second request asks Noul whether the target is clearly visible and unique, and Box where it is. Both must pass `policy.min_target_visibility` (default `0.9`) and `policy.min_box_confidence` (default `0.8`). These are configurable prototype thresholds, not validated safety guarantees. Absent, ambiguous, low-confidence, malformed or failed grounding yields `fallback` with `computer_action: null`.

`computer_action.args.x/y` are the box center in **screenshot pixels**, rounded down and bounded to the image. `grounding` contains normalized edges and visibility/confidence. `computer_action.screenshot` contains the SHA-256 of decoded image bytes, dimensions and `requires_current: true`. The host must re-check freshness, focus, coordinate mapping (including crop/window origin and DPI), availability and native approval immediately before dispatch. Re-observe after execution; stop or fall back on stale state or lack of progress. Record the result using the original `correlation_id`.

### Image privacy and replay

Images travel in route `assets`, outside the bounded text projection; generic `jev_route` attaches their references once as `state.visual_assets`. Do not duplicate those references in context unless another image expansion is intended. Do not place base64 in capability descriptions or free-text prompts.

Routing cases and retained receipt requests omit images and set `assets_omitted: true`; bounded host results redact `data_base64`. Visual replay fails open until the host explicitly restores the original assets and removes that marker. Screenshots may still contain secrets: redact them before sending to a remote provider. The layer does not provide local vision or an OS executor.

## Minimum verification matrix

An implementation is not complete until it proves these observable behaviors:

| Scenario | Required result |
| --- | --- |
| Valid low-risk selection | Host executes the matching native capability once. |
| Unknown or stale selected id | Host does not execute; normal fallback remains available. |
| `needs_confirmation` | Host approval is requested before execution. |
| Approval denied | No host execution; receipt is `not_started`. |
| Jev disabled/unavailable/error | Normal host path continues without guessed selection. |
| Native execution failure | Receipt is `failed` with the same `correlation_id`. |
| Successful native execution | Receipt is `completed` with bounded result/timing metadata. |
| Replay evaluation | Routing/receipt cases replay without host execution. |

Run the existing project checks plus the matching adapter smoke fixture. At minimum, a jev-layer integration should preserve the checks in `CONTRIBUTING.md` and add a harness-specific offline fixture; provider credentials are not required for ordinary CI.

## Common incorrect implementations

- **Calling Jev after executing the tool.** Routing must happen before the host action.
- **Passing every hidden tool to Jev.** Send only a closed, host-owned candidate set.
- **Treating `selected` as authorization.** The host still validates permissions and approval.
- **Executing the returned id directly.** Map it through the native registry; never use it as a command.
- **Replacing fail-open with a retry loop.** Return to the existing host path.
- **Letting Jev discover or mutate global config.** Discovery and configuration remain explicit and user-owned.
- **Adding provider calls to ordinary CI.** Use the deterministic `demo` provider and injected fixtures.
- **Reporting only that an adapter was added.** Show the preserved execution path, receipt correlation, and fallback evidence.
