# Schema and compatibility policy

[English](../README.md) | [Русский](../README.ru.md) | [简体中文](../README.zh-CN.md)

The current public contracts are **schema version 1**. The implementation already emits `schema_version: 1` for route requests, decision envelopes, routing cases, execution receipts, and supervision cases. A new public release must not silently change the meaning of those v1 fields.

## Version rules

- **Patch release:** bug fixes and documentation changes; v1 meanings remain unchanged.
- **Minor release:** additive optional fields, new providers, new adapters, or new capability kinds that v1 consumers can ignore.
- **Major release:** removed/renamed required fields, changed field types or meanings, changed correlation semantics, or a host-approval contract change.
- Unknown fields must be ignored by readers. Writers must not emit a required field unless it is part of the declared schema version.
- New runtime behavior must remain opt-in and fail open unless the existing contract explicitly requires it.

A breaking schema requires a new schema version, migration notes, fixtures for both versions, and an adapter compatibility decision. Do not change v1 to avoid writing a migration.

## MCP tools

The MCP server currently exposes these stable tool names:

- `jev_route`
- `jev_browser_step` (experimental, opt-in)
- `jev_supervise` (experimental, opt-in)
- `jev_record_execution`

Their input and structured output are v1. Additive optional properties are compatible. Renaming a tool, changing a required property, changing the meaning of a status, or changing who owns execution requires a new tool/schema version and adapter migration. Keep `tools/list`, `initialize`, and stdio JSON-RPC behavior backward compatible for v1 clients.

## Routing decision schema

A v1 decision includes at least:

- `schema_version`
- `correlation_id`
- `status`
- `selected`
- `confidence`
- `probabilities`
- `reason`
- `candidates`
- `fallback`
- `execution` with host execution initially `not_started`
- `receipt`

The selected id is advisory until the host resolves it against its own capability registry and permissions. `correlation_id` is the join key for routing and execution records.

## Execution receipts

A v1 `execution_receipt` is append-only JSONL data with:

- `record_type: "execution_receipt"`
- `schema_version: 1`
- `receipt_id`
- `correlation_id`
- `harness`
- the selected/candidate decision summary;
- Jev provider, latency, cost, and status;
- bounded host status/result/error plus optional exit and timing metadata.

The host must record `completed`, `failed`, or `not_started`. Receipts must not contain unbounded prompts, secrets, or raw credentials. Receipts are evidence of what the host reported; they do not grant permission or prove that Jev executed anything.

## Replay cases

A v1 replay file is JSONL. Supported records include:

- `record_type: "routing_case"`
- `record_type: "execution_receipt"`
- `record_type: "supervision_case"`

Routing cases retain a sanitized request and a decision summary. Replay reads cases without calling host tools. New optional record fields are compatible; changing record type, correlation semantics, or the meaning of a recorded status requires a new replay schema and migration.

## Adapter contract

The adapter contract is currently **v1** and is intentionally separate from provider/model versions. A v1 adapter must:

1. submit a bounded candidate set;
2. call `jev_route` or the equivalent CLI contract;
3. preserve `correlation_id`;
4. keep native execution and permissions in the host;
5. preserve approval decisions;
6. call `jev_record_execution` after host execution or denial;
7. fail open to the native path when Jev is unavailable or inconclusive.

An adapter that cannot preserve these invariants is not v1-compatible. Record supported adapter versions in integration documentation and release checklists.

## Compatibility review

For every release, review:

- v1 request/decision fixtures;
- MCP `tools/list` and `tools/call` smoke cases;
- receipt/replay round trips;
- all supported adapter examples;
- fail-open and approval-denial paths;
- package contents and translated documentation.
