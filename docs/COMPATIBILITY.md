# Harness compatibility baseline

[English](../README.md) | [Русский](../README.ru.md) | [简体中文](../README.zh-CN.md)

This is the first-release compatibility baseline observed on 2026-09-19. It records the installed harness versions used for the release-preparation checks; it is not a claim that every provider/model combination was exercised.

| Harness | Version observed | Release-preparation coverage |
| --- | --- | --- |
| OMP | `18.2.6` | `omp --version`; OMP extension contract and host-owned execution path reviewed; Jev core smoke uses the same MCP/CLI contract. |
| Hermes | `0.21.3` (`upstream b675e6de`) | `hermes --version`; Python adapter syntax/contract reviewed; Jev core smoke uses the same CLI/MCP contract. |
| Codex CLI | `0.155.1` | `codex --version`; Codex MCP transport fixture and host-execution ownership path reviewed. The fixture does not invoke a Codex model. |

The adapters are thin and target the stable v1 contract documented in [CONTRIBUTING.md](../CONTRIBUTING.md) and [SCHEMA-VERSIONING.md](SCHEMA-VERSIONING.md). Full interactive harness/model/provider coverage is environment-specific and is not required for ordinary PR CI.

When a public release supports a different harness version, update this table, rerun the adapter/transport checks, and document any compatibility change in `CHANGELOG.md` before tagging.

## Jev 1.14 verification — 2026-10-15

- Existing v1 text contracts remain unchanged. Direct TypeSafe defaults to `jev-1.14.0`; OpenRouter defaults to `typesafe/jev-1.14`.
- Live OpenRouter alpha Decisions routing resolved `typesafe/jev-1.14-20261014` and selected an eligible capability without execution.
- Vision/browser/computer-use transport was exercised through an actual stdio MCP process and a loopback HTTP fixture: image bytes/header/model, confirmation, absent-target fallback, screenshot coordinate mapping, correlated denial receipt, browser-loop execution by the fixture host, and image-free replay.
- Live OpenRouter vision with the corrected `image_url` Decisions format classified red and blue PNGs correctly (confidence 1 each). The actual MCP computer tool selected a screenshot-only red rectangle and grounded its click at `(200, 148)` within the known rectangle, with visibility 0.97 and Box confidence 0.98. Host confirmation was required and no desktop input was dispatched; the correlated denial receipt omitted screenshot bytes.
- No direct TypeSafe API key was available for live accuracy testing. Earlier OpenRouter probes with TypeSafe's `assets` format were invalid transport probes, not evidence against OpenRouter vision support. Physical input dispatch, full interactive harnesses, DPI/crop mapping and general visual accuracy remain host/environment-specific and are not established by these controlled checks.
- Windows release checks: `npm test` passed 117 tests with two optional Python-transport skips; core smoke, fail-open, browser MCP e2e, MCP receipts, feature flags, supervision, context filtering and capability e2e passed. A separate Python → Node → loopback HTTP smoke exercised computer grounding and a correlated denial receipt. Cross-platform clean-install smoke now passes on Windows using native Node entrypoints, with installed CLI/MCP, correlated receipts and execution-free replay.
