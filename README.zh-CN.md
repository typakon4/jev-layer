<p align="center">
  <img src="docs/jev-layer-banner.svg" alt="jev-layer — 面向 agent harness 的可移植 System-1 决策层" width="960">
</p>

<h1 align="center">jev-layer</h1>

<p align="center">
  <strong>面向 agent harness 的可移植 System-1 决策层。</strong><br>
  Host 保留 routing、receipts、replay 和 fail-open 集成的所有权。
</p>

<p align="center">
  Hermes · OMP · Codex · generic MCP
</p>

<p align="center">
  <a href="https://github.com/typakon4/jev-layer/actions/workflows/ci.yml?query=branch%3Amain"><img alt="CI status" src="https://github.com/typakon4/jev-layer/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/jev-layer"><img alt="npm version" src="https://img.shields.io/npm/v/jev-layer?logo=npm&amp;label=npm"></a>
  <a href="https://github.com/typakon4/jev-layer/releases"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/typakon4/jev-layer?display_name=tag&amp;sort=semver"></a>
  <a href="https://github.com/typakon4/jev-layer/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/typakon4/jev-layer"></a>
  <a href="https://www.npmjs.com/package/jev-layer"><img alt="npm downloads per month" src="https://img.shields.io/npm/dm/jev-layer?logo=npm&amp;label=downloads"></a>
</p>

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md)

jev-layer 只负责路由有界决策并记录证据；host 保留执行、权限、审批、重试、恢复和最终结果的所有权。

## 架构

<p align="center">
  <img src="docs/architecture.svg" alt="架构：agent harness 向 jev-layer 发送有界请求；host 负责权限和执行；receipts 支持 replay。" width="960">
</p>

Jev 从不执行选中的 capability。可使用离线确定性的 `demo`、OpenRouter Decisions 或 TypeSafe；普通 CI 不需要 provider credentials。

## 快速开始

需要 Node.js 20 或更新版本。没有必需的 runtime 依赖。

安装已发布的 CLI：

```sh
npm install --global jev-layer
```

或者使用本地 clone：

```sh
npm install
npm link
jev install --project /path/to/workspace
jev add generic --project /path/to/workspace
jev doctor --project /path/to/workspace
```

`npm link` 仅用于本地安装，不会发布包。如果不想全局 link，可使用 `node /path/to/jev-layer/bin/jev.mjs ...`。默认 provider 是离线确定性的 `demo`。

直接运行 stdio MCP：

```sh
jev mcp
```

凭据必须保存在仓库之外：

```sh
export JEV_LAYER_PROVIDER=openrouter
export OPENROUTER_API_KEY='provided-by-your-secret-store'
jev doctor --project /path/to/workspace
```

## 核心能力

- **Routing：** `jev_route` 从 host 提供的候选集合中选择一个 capability。host 会再次验证 id 和权限。
- **Receipts/replay：** `jev_record_execution` 使用原始 `correlation_id` 关联 host 结果。JSONL 位于 `.jev/replay/cases.jsonl`，可用 `npm run replay:evaluate` 离线评估。
- **Supervision：** `jev_supervise` 返回有界的工作状态判断；确定性的 host policy 将其映射为 `continue`、`verify`、`retry`、`finish` 或 `escalate`。Jev 不执行这些动作。
- **Context filtering：** 可选的确定性 `shadow` 或 `conservative` 过滤器减少过期 context，不使用 LLM 摘要。
- **Experimental browser fast-path：** `jev_browser_step` 根据 host observation 选择一个有界浏览器动作。observation、审批、原生执行和恢复都由 host 提供。
- **Fail-open：** Jev 被禁用、不可用、出错或无法确定时，控制权返回 host 的正常路径。Jev 不扩大权限，也不猜测执行。

所有可选表面默认关闭：

```sh
JEV_BROWSER_FAST_PATH=1 jev mcp
JEV_SUPERVISION=1 jev mcp
JEV_CONTEXT_FILTER=shadow jev cli --input examples/route-request.json
```

## Harness adapters

示例位于 `integrations/`：

- `integrations/hermes/`
- `integrations/omp/`
- `integrations/codex/`
- `integrations/template/`

发布基线记录了准备环境中观察到的 OMP `18.2.6`、Hermes `0.21.3`（`b675e6de`）和 Codex CLI `0.155.1`。这是版本与契约基线，不代表覆盖所有 provider/model 组合；详见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

### 添加新的 harness

1. 复制 `integrations/template/adapter.mjs`。
2. 添加 `integrations/<harness>/` 和不含 secret 的 config/example。
3. 调用 `jev_route`，保留 `correlation_id`，仅通过 host registry 执行，然后调用 `jev_record_execution`。
4. 添加覆盖成功、fail-open、审批拒绝和 execution receipt 的离线 smoke fixture。
5. 记录支持的版本并通过 CI。

详见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [docs/SCHEMA-VERSIONING.md](docs/SCHEMA-VERSIONING.md)。

## Browser 状态

Browser fast-path 的**可靠性已通过当前 real-browser fixtures 验证**，包括动作顺序、可见链接导航、原生 select、审批拒绝和恢复。**性能优化仍是实验性的**。不宣称任何浏览器加速倍数。

## 安全与兼容性

- MIT 许可证：[LICENSE](LICENSE)。
- jev-layer 不是 security boundary。权限和审批的权威来源是 host：[SECURITY.md](SECURITY.md)。
- MCP tools、routing decisions、receipts、replay cases 和 adapter contract 当前都是 version 1。应优先添加可选字段，不要静默破坏 v1。
- 不要提交 credentials、含 secret 的 logs、`.env` 或 machine-specific paths。

## 验证

```sh
npm test
npm run smoke
npm run fail-open-smoke
npm run clean-install-smoke
npm pack --dry-run
```

GitHub Actions 在 Node.js 20、22 和 24 上运行这些检查。Provider-backed 测试需要单独的 secret-managed 环境，不属于普通 PR CI。

文档：[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [RELEASE.md](RELEASE.md) · [CHANGELOG.md](CHANGELOG.md)。
