<p align="center">
  <img src="docs/jev-layer-banner.svg" alt="jev-layer — портируемый System-1 слой решений для agent harnesses" width="960">
</p>

<h1 align="center">jev-layer</h1>

<p align="center">
  <strong>Портируемый System-1 слой решений для agent harnesses.</strong><br>
  Host владеет routing, receipts, replay и fail-open интеграциями.
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

jev-layer маршрутизирует ограниченные решения и сохраняет доказательства; harness сохраняет владение исполнением, permissions, approvals, retry, восстановлением и итоговым результатом.

## Архитектура

<p align="center">
  <img src="docs/architecture.svg" alt="Архитектура: harness отправляет ограниченный запрос в jev-layer; host владеет permissions и execution; receipts поддерживают replay." width="960">
</p>

Jev не исполняет выбранную capability. Доступны детерминированный `demo`, OpenRouter Decisions и TypeSafe; тесты с provider credentials не требуются для обычного CI.

## Быстрый старт

Требуется Node.js 20 или новее. Обязательных runtime-зависимостей нет.

Установить опубликованный CLI:

```sh
npm install --global jev-layer
```

Или использовать локальный clone:

```sh
npm install
npm link
jev install --project /path/to/workspace
jev add generic --project /path/to/workspace
jev doctor --project /path/to/workspace
```

`npm link` используется только локально и ничего не публикует. Вместо него можно запускать `node /path/to/jev-layer/bin/jev.mjs ...`. Provider по умолчанию — офлайн-детерминированный `demo`.

Для stdio MCP:

```sh
jev mcp
```

Секреты должны находиться вне репозитория:

```sh
export JEV_LAYER_PROVIDER=openrouter
export OPENROUTER_API_KEY='provided-by-your-secret-store'
jev doctor --project /path/to/workspace
```

## Основные поверхности

- **Routing:** `jev_route` выбирает одну capability из набора, предоставленного host. Host повторно проверяет id и permissions.
- **Receipts/replay:** `jev_record_execution` связывает результат host с исходным `correlation_id`. JSONL-файлы находятся в `.jev/replay/cases.jsonl` и проверяются офлайн через `npm run replay:evaluate`.
- **Supervision:** `jev_supervise` возвращает ограниченные judgments о состоянии работы; детерминированная host policy преобразует их в `continue`, `verify`, `retry`, `finish` или `escalate`. Jev эти действия не выполняет.
- **Context filtering:** опциональная детерминированная фильтрация `shadow` или `conservative` убирает устаревший context без LLM-суммаризации.
- **Experimental browser fast-path:** `jev_browser_step` выбирает одно ограниченное действие из observation host. Host предоставляет observation, approval, native execution и recovery.
- **Fail-open:** при отключённом, недоступном, ошибочном или неубедительном Jev вызове управление возвращается в обычный host path. Jev не расширяет permissions и не угадывает execution.

Опциональные поверхности по умолчанию отключены:

```sh
JEV_BROWSER_FAST_PATH=1 jev mcp
JEV_SUPERVISION=1 jev mcp
JEV_CONTEXT_FILTER=shadow jev cli --input examples/route-request.json
```

## Harness adapters

Примеры находятся в `integrations/`:

- `integrations/hermes/`
- `integrations/omp/`
- `integrations/codex/`
- `integrations/template/`

Для release baseline зафиксированы версии OMP `18.2.6`, Hermes `0.21.3` (`b675e6de`) и Codex CLI `0.155.1`, наблюдавшиеся в среде подготовки. Это базовая проверка версий и контрактов, а не полный набор provider/model tests; подробности — в [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

### Добавление нового harness

1. Скопируйте `integrations/template/adapter.mjs`.
2. Добавьте `integrations/<harness>/` и secret-free config/example.
3. Вызовите `jev_route`, сохраните `correlation_id`, исполняйте только через native registry host, затем вызовите `jev_record_execution`.
4. Добавьте offline smoke fixture для успеха, fail-open, отказа в approval и execution receipt.
5. Зафиксируйте поддерживаемые версии и пройдите CI.

Подробности: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/SCHEMA-VERSIONING.md](docs/SCHEMA-VERSIONING.md).

## Статус browser

Надёжность browser fast-path **проверена на текущих real-browser fixtures**: sequencing, visible-link navigation, native select, approval denial и recovery. **Оптимизация производительности остаётся экспериментальной**. Заявлений об ускорении браузера нет.

## Безопасность и совместимость

- Лицензия MIT: [LICENSE](LICENSE).
- jev-layer не является security boundary. Источник истины для permissions и approvals — host: [SECURITY.md](SECURITY.md).
- MCP tools, routing decisions, receipts, replay cases и adapter contract сейчас имеют version 1. Изменения должны быть additive и не ломать v1 молча.
- Не коммитьте credentials, секретные logs, `.env` или machine-specific paths.

## Проверка

```sh
npm test
npm run smoke
npm run fail-open-smoke
npm run clean-install-smoke
npm pack --dry-run
```

GitHub Actions запускает эти проверки на Node.js 20, 22 и 24. Provider-backed тесты требуют отдельного secret-managed окружения и не входят в обычный PR CI.

Документы: [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [RELEASE.md](RELEASE.md) · [CHANGELOG.md](CHANGELOG.md).
