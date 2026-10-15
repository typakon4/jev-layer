# Changelog

All notable changes to jev-layer are recorded here. Entries describe public behavior and compatibility impact; provider-specific experiments are listed only when they affect a public contract.

## [0.3.0] - 2026-10-15

### Added

- Direct TypeSafe PNG/JPEG image input with bounded asset validation and the experimental Images/Box opt-in header.
- OpenRouter vision/Box support via inline Decisions `image_url` parts, with automatic conversion from the layer's shared assets/references format.
- Opt-in `jev_computer_step` in MCP and Hermes: closed host actions, explicit computer permissions, confirmation, paired visibility/Box grounding and screenshot-bound coordinates.
- Screenshot input for browser decisions and the host-owned browser fast-path.

### Changed

- Pin direct TypeSafe to `jev-1.14.0` and OpenRouter to `typesafe/jev-1.14`; explicit model overrides remain supported. Image-path errors fail open without copying image bytes into receipts.
- Preserve browser action arguments in MCP/Hermes output. Raise the Hermes process timeout to 10 seconds for multi-call grounding.
- Exclude screenshot bytes from text projection, durable replay and pending receipt requests; visual replay requires original images.
- Keep all contracts on schema version 1 and computer use disabled by default.

### Fixed

- Generate native Node/entrypoint adapter commands on Windows instead of relying on npm `.cmd` shims.
- Exercise a real installed package in cross-platform clean-install smoke; correct Windows URL paths and shutdown handling in MCP receipt smoke.
- Report the installed package version during MCP initialization.

### Distribution

- [npm `jev-layer@0.3.0`](https://www.npmjs.com/package/jev-layer/v/0.3.0) · [GitHub `v0.3.0`](https://github.com/typakon4/jev-layer/releases/tag/v0.3.0).
- Rollback: pin `jev-layer@0.2.0` and restart the MCP process; that version does not provide the new vision/computer-use surface. Report release issues through the repository issue tracker.

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
