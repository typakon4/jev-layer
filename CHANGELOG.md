# Changelog

All notable changes to jev-layer are recorded here. Entries describe public behavior and compatibility impact; provider-specific experiments are listed only when they affect a public contract.

## [0.2.0] - 2026-09-25

### Added

- Advisory `jev_model_route` recommendations with correlated execution outcomes and a local evidence report. Recommendations do not change the host's provider or model.
- Report-only `jev_shadow_compaction` candidates for host-supplied context. It does not summarize, mutate, or delete context.
- Expanded Hermes integration for provider selection, receipts, model-route correlation, supervision, and browser decisions.
- Evidence-state handling for supervision; contradictory evidence cannot produce a `finish` decision.

### Fixed

- Route `typesafe` through the official System One provider in the CLI, stdio MCP server, and adapters. Added offline regression coverage for the reported failure.
- Apply configured provider environment names consistently across CLI and MCP surfaces, including supervision and browser decisions.
- Preserve configured provider options in the Hermes integration and send OpenRouter's optional app title.

### Compatibility

- Node.js `>=20`.
- Public request, decision, MCP tool, receipt, replay, and adapter contracts remain schema version 1.
- Provider-backed tests are not required for ordinary PR CI; normal CI covers provider behavior with offline fixtures.

## [0.1.0] - 2026-09-19

Initial public release.

### Added

- Portable CLI and stdio MCP routing layer for Hermes, OMP, Codex, and generic MCP-compatible agents.
- Closed-set capability routing through `jev_route` with deterministic host-side policy checks.
- `jev_record_execution` and append-only JSONL routing/execution receipts joined by `correlation_id`.
- Offline replay/evaluation without host execution calls.
- Opt-in supervision judgments with deterministic host policy.
- Opt-in deterministic context filtering (`shadow` and `conservative`).
- Explicit capability discovery for skills, MCP, CLI, DSH, tools, subagents, and models.
- Experimental, opt-in browser fast-path over host-supplied observations.
- MIT license, security policy, schema/version policy, contribution guide, adapter template, CI, and multilingual README documentation.

### Compatibility

- Node.js `>=20`.
- Public request, decision, MCP tool, receipt, replay, and adapter contracts remain schema version 1.
- Browser reliability was validated against real-browser fixtures; browser performance optimization remains experimental.
