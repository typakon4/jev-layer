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
