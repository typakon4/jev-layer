# Changelog

All notable changes to jev-layer are recorded here. Entries describe public behavior and compatibility impact; provider-specific experiments are listed only when they affect a public contract.

## Unreleased

### Fixed

- Route `typesafe` through the official System One provider; share provider resolution with supervision and preserve fail-open decisions for unsupported providers.
- Apply configured provider environment names in CLI/MCP, including supervision and browser decisions; let Hermes/OMP honor project provider selection.
- Send OpenRouter's optional app title and record the configured model in provider metadata; allow the Hermes process to outlive the provider HTTP timeout.
- Cover demo, OpenRouter, and TypeSafe routing with offline provider and CLI/MCP/adapter regression checks; document setup and configuration precedence.

## [0.1.0]

First public-release candidate. This version is prepared but has not been pushed, released on GitHub, or published to npm.

### Added

- Portable CLI and stdio MCP routing layer for Hermes, OMP, Codex, and generic MCP-compatible agents.
- Closed-set capability routing through `jev_route` with deterministic host-side policy checks.
- `jev_record_execution` and append-only JSONL routing/execution receipts joined by `correlation_id`.
- Offline replay/evaluation without host execution calls.
- Opt-in supervision judgments with deterministic host policy.
- Opt-in, report-only `jev_model_route` with correlated execution outcomes and a local evidence report.
- Hermes plugin integration with profile-scoped OpenRouter secret resolution, replay receipts, model-route correlation, and a local-agent handoff guide.
- Opt-in deterministic context filtering (`shadow` and `conservative`).
- Explicit capability discovery for skills, MCP, CLI, DSH, tools, subagents, and models.
- Experimental, opt-in browser fast-path over host-supplied observations.
- MIT license, security policy, schema/version policy, contribution guide, adapter template, CI, and multilingual README documentation.

### Compatibility

- Node.js `>=20`.
- Public request, decision, MCP tool, receipt, replay, and adapter contracts remain schema version 1.
- Release-preparation baseline: OMP `18.2.6`, Hermes `0.21.3` (`b675e6de`), and Codex CLI `0.155.1` observed in the preparation environment. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- Browser reliability is validated against the current real-browser fixtures; browser performance optimization remains experimental.

### Release constraints

- Host harnesses retain ownership of permissions, approvals, native execution, retries, recovery, and final results.
- Provider-backed tests require explicit secret-managed environments and are not required for ordinary PR CI.
- No npm publication, GitHub release, or remote push is part of this preparation.

Proposed repository: https://github.com/typakon4/jev-layer. GitHub release and comparison links become active after repository creation.
