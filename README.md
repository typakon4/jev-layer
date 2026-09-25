<p align="center">
  <img src="docs/jev-layer-banner.svg" alt="jev-layer — portable System-1 decisions for agent harnesses" width="960">
</p>

<h1 align="center">jev-layer</h1>

<p align="center">
  <strong>Let an agent make a bounded choice without handing it control.</strong><br>
  Jev recommends. Your harness still checks permissions and executes.
</p>

<p align="center">Hermes · OMP · Codex · generic MCP</p>

<p align="center">
  <a href="https://github.com/typakon4/jev-layer/actions/workflows/ci.yml?query=branch%3Amain"><img alt="CI status" src="https://github.com/typakon4/jev-layer/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/jev-layer"><img alt="npm version" src="https://img.shields.io/npm/v/jev-layer?logo=npm&amp;label=npm"></a>
  <a href="https://github.com/typakon4/jev-layer/releases"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/typakon4/jev-layer?display_name=tag&amp;sort=semver"></a>
  <a href="https://github.com/typakon4/jev-layer/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/typakon4/jev-layer"></a>
</p>

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md)

**Install:** `npm install --global jev-layer`  ·  [Integrate a harness](docs/AGENT-IMPLEMENTATION.md) · [Security model](SECURITY.md)

## What changes

| Without Jev | With Jev |
| --- | --- |
| Your harness follows its existing path to choose a capability. | The harness can ask `jev_route` to choose from a bounded set it supplies. |
| Your harness owns permissions, approvals, and execution. | Your harness still owns permissions, approvals, and execution. |
| Execution results stay in the host's normal workflow. | The host can attach the result to the decision with `jev_record_execution` and replay cases offline. |

Jev never executes a selected capability. If it is disabled, unavailable, invalid, or inconclusive, control returns to the host's normal path.

## Quick start

Requires Node.js 20 or newer. There are no mandatory runtime dependencies.

```sh
npm install --global jev-layer
jev install --project /path/to/workspace
jev add generic --project /path/to/workspace
jev doctor --project /path/to/workspace
```

The default `demo` provider is deterministic and works offline. To run the stdio MCP server directly:

```sh
jev mcp
```

## How it fits into a harness

<p align="center">
  <img src="docs/architecture.svg" alt="Architecture: agent harnesses send bounded requests to jev-layer; the host owns permissions and execution; receipts support replay." width="960">
</p>

1. The host sends Jev a request and the candidate capabilities it already allows.
2. Jev returns a bounded recommendation. The host checks it against its own registry and permissions.
3. The host decides whether to execute, then can record what happened against the original `correlation_id`.

A provider can be deterministic `demo`, OpenRouter Decisions, or TypeSafe. Provider-backed tests are not required for normal CI; see the [provider guide](docs/PROVIDERS.md).

## What else it can do

- **Supervision:** `jev_supervise` returns bounded work-state judgments. The host decides whether to continue, verify, retry, finish, or escalate.
- **Model routing:** `jev_model_route` recommends one host-declared model profile for a future call. It is advisory only; the host measures outcomes before changing provider or model settings. Correlated receipts can be reviewed with `npm run model-route:report -- /path/to/cases.jsonl`.
- **Shadow compaction:** `jev_shadow_compaction` produces report-only keep/drop candidates for host-supplied context. It does not summarize, mutate, or delete context, and keeps pinned evidence on provider failure.
- **Context filtering:** optional deterministic `shadow` or `conservative` filtering reduces stale context without LLM summarization.
- **Experimental browser fast-path:** `jev_browser_step` recommends one bounded action from a host observation. The host supplies approval, native execution, and recovery; Jev does not start a browser worker.
- **Fail open:** optional Jev surfaces are disabled by default. Jev never widens permissions or guesses execution.

Enable optional surfaces explicitly:

```sh
JEV_BROWSER_FAST_PATH=1 jev mcp
JEV_SUPERVISION=1 jev mcp
JEV_CONTEXT_FILTER=shadow jev cli --input examples/route-request.json
```

For provider credentials, keep keys outside the repository:

```sh
export JEV_LAYER_PROVIDER=openrouter
export OPENROUTER_API_KEY='provided-by-your-secret-store'
jev doctor --project /path/to/workspace
```

## Pick an integration

Examples and adapters live under `integrations/`:

- Hermes: `integrations/hermes/` (see the [local-agent handoff guide](docs/HERMES-LOCAL-AGENT-HANDOFF.ru.md))
- OMP: `integrations/omp/`
- Codex: `integrations/codex/`
- Another harness: start from `integrations/template/`

Adapters stay thin. The host retains native capability lookup, permissions, approvals, execution, retries, recovery, and final output. For the adapter contract, see [CONTRIBUTING.md](CONTRIBUTING.md). For compatibility rules, see [docs/SCHEMA-VERSIONING.md](docs/SCHEMA-VERSIONING.md).

The release baseline records OMP `18.2.6`, Hermes `0.21.3` (`b675e6de`), and Codex CLI `0.155.1` observed in the preparation environment. This is a version/contract baseline, not a claim of full provider/model coverage; see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Boundaries

- jev-layer is not a security boundary. Host permissions and approvals remain authoritative; see [SECURITY.md](SECURITY.md).
- Schema, MCP tool, receipt, replay, and adapter contracts are currently version 1. Prefer additive changes; do not break v1 silently.
- Browser fast-path reliability is validated against current real-browser fixtures. Performance optimization remains experimental; no browser speedup claim is made.
- Do not commit credentials, logs containing secrets, `.env` files, or machine-specific paths.

## Verify locally

```sh
npm test
npm run smoke
npm run fail-open-smoke
npm run clean-install-smoke
npm pack --dry-run
```

GitHub Actions runs these checks on Node.js 20, 22, and 24. Provider-backed tests require a secret-managed environment and are not part of ordinary PR CI.

## Project docs

[Agent implementation guide](docs/AGENT-IMPLEMENTATION.md) · [Providers](docs/PROVIDERS.md) · [Compatibility](docs/COMPATIBILITY.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Release](RELEASE.md) · [Changelog](CHANGELOG.md)
