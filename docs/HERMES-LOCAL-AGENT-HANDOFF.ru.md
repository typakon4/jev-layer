# Hermes integration: handoff для локального агента

Этот документ описывает **текущую рабочую интеграцию** `jev-layer` в Hermes. Он нужен локальному агенту, чтобы сначала понять границы и точки входа, а не повторно «интегрировать Jev» через глобальный конфиг, произвольные shell-команды или второй executor.

## Что уже установлено

- Исходный репозиторий: `/home/hermes/jev-layer`.
- Активная plugin-копия Hermes: `~/.hermes/plugins/jev-layer`.
- Plugin регистрирует ровно шесть tools:
  - `jev_route`;
  - `jev_record_execution`;
  - `jev_supervise`;
  - `jev_browser_step`;
  - `jev_shadow_compaction`;
  - `jev_model_route`.
- Replay evidence активного профиля: `~/.hermes/jev-layer/replay/cases.jsonl`.
- Gateway загружает Python plugin при старте. После изменения `integrations/hermes/*`, `plugin.yaml` или списка tools нужен пользовательский `/restart` gateway.

Не путай surfaces:

```text
/home/hermes/jev-layer                 source checkout, тесты и документация
~/.hermes/plugins/jev-layer            установленная plugin-копия текущего профиля
~/.hermes/jev-layer/replay/cases.jsonl profile-scoped evidence, не source artifact
~/.hermes/config.yaml                  глобальный Hermes config; не менять для этой plugin без явного задания
```

## Главный принцип

```text
Hermes registry/permissions/approval/executor/recovery
                 │ closed, bounded input
                 ▼
            jev-layer decision
                 │ correlation_id, advice only
                 ▼
Hermes validates → native execution → jev_record_execution → JSONL evidence
```

Jev **никогда** не получает право исполнять tool, shell, URL или browser action. Любое решение — advisory. Hermes остаётся владельцем discovery, policy, approval, native execution, retry, recovery и финального ответа.

Если Jev выключен, недоступен, даёт невалидный ответ или низкую уверенность, текущий normal Hermes path продолжается. Не добавляй обходной executor и не меняй retry semantics.

## Файловая карта

| Зачем | Файл |
| --- | --- |
| Hermes tool registration + profile-scoped secret bridge | `integrations/hermes/__init__.py` |
| JSON schemas шести tool surfaces | `integrations/hermes/schemas.py` |
| Plugin manifest | `integrations/hermes/plugin.yaml`, `plugin.yaml` |
| Один JSONL request/response adapter process | `src/hermes-adapter.mjs` |
| Общая bounded routing contract | `src/route.mjs`, `src/contract.mjs` |
| Receipt/replay JSONL format | `src/receipts.mjs` |
| Browser action space, progress и recovery | `src/browser.mjs` |
| Model recommendation | `src/model-routing.mjs` |
| Model-route evidence report | `src/model-route-metrics.mjs`, `scripts/model-route-report.mjs` |
| Context keep/drop report | `src/shadow-compaction.mjs` |
| Work-state judgement | `src/supervision.mjs` |
| Harness-neutral integration contract | `docs/AGENT-IMPLEMENTATION.md` |

## Как работают tools

### `jev_route`

Hermes сначала собирает **закрытый** `capabilities[]` из своего registry. Jev выбирает один известный id. До исполнения Hermes снова проверяет: `status`, точное совпадение id, availability, permission, risk и approval. После результата используется `jev_record_execution` с тем же `correlation_id`.

Нельзя передавать в candidates hidden tools, raw shell command, credential, неограниченную историю или capability, для которой у Hermes нет native executor.

### `jev_record_execution`

Принимает результат уже выполненного/отклонённого host action. `correlation_id` должен принадлежать decision того же gateway process. Статусы: `completed`, `failed`, `not_started`.

Receipt — evidence, не источник авторизации. В `result` нельзя писать токены, пароли, номера карт и полный неочищенный лог.

### `jev_model_route`

Возвращает рекомендацию одного из **host-declared** `models[]`. Всегда `route_mode: "shadow"`; он не меняет Hermes provider, model или reasoning effort.

Когда host закончил реальный model call, он записывает outcome через `jev_record_execution`:

```json
{
  "correlation_id": "из jev_model_route",
  "capability_id": "recommended model id",
  "status": "completed",
  "result": {
    "model_route": {
      "actual_model_id": "фактически использованный id",
      "retry_count": 0,
      "outcome": "verified"
    }
  }
}
```

Отчёт только читает receipts:

```bash
npm run model-route:report -- ~/.hermes/jev-layer/replay/cases.jsonl
```

Пока не накоплены репрезентативные outcomes/retries/latency/cost, **не включать** auto-switching моделей.

### `jev_browser_step`

Принимает только snapshot, который сделал host: `url`, visible text, targets, tabs, scroll и progress. Возвращает один bounded action: scroll, switch tab, visible link navigation, click, native select или handoff.

- `scroll` и `switch_tab` могут быть исполнены только через native Hermes browser executor.
- `click`, `select`, `navigate` требуют host approval.
- `submit`, login, payment, delete, секретный ввод и `TYPE_TEXT` не являются быстрым Jev execution path.
- Progress не даёт повторять уже выполненный target и блокирует повторный scroll без измеримого состояния страницы.
- После каждого host шага можно записать routing case и execution receipt; это позволяет replay без повторного browser execution.

`browser-use/jev-ultrafast` был использован как архитектурный reference (динамическая индексированная action space), но его cloud/browser worker **не установлен и не запущен**. Не подменяй Hermes browser security model его executor'ом.

### `jev_shadow_compaction`

Возвращает консервативный report keep/drop для переданного context. Не меняет prompt, не удаляет сообщения и не заменяет host compaction. Pinned requirements, paths, errors и commands сохраняются без provider review; provider error удерживает всё.

### `jev_supervise`

Делает bounded judgement о work state. Hermes, не Jev, преобразует его в `continue`, `verify`, `retry`, `finish` или `escalate`. Contradictory evidence не может закончиться `finish`.

## Secrets и providers

`integrations/hermes/__init__.py` получает `OPENROUTER_API_KEY` только через Hermes profile-scoped secret store (`agent.secret_scope.get_secret`). Ключ передаётся лишь в короткоживущий локальный Node adapter; не возвращается в tool output и не логируется.

Для локальных/offline tests используй `provider: "demo"`. Provider-backed проверки — отдельные, opt-in; ключи никогда не клади в repo, plugin manifest, test fixture или обычный shell history.

## Безопасный change workflow

1. Прочитай этот документ и `docs/AGENT-IMPLEMENTATION.md`.
2. Проверь target surface: source checkout, installed plugin copy, active profile или global config.
3. Измени source в `/home/hermes/jev-layer` и сначала добавь/измени offline test.
4. Запусти узкий test, затем полный suite.
5. Синхронизируй **только нужные** source files в `~/.hermes/plugins/jev-layer`.
6. Запусти `hermes plugins doctor jev-layer`.
7. Если менялась регистрация/handler/schema/manifest, попроси пользователя о `/restart`.
8. После restart проверь живой gateway tool path и read back exact receipt/report.
9. Не делай `git push`, npm publish, GitHub release или изменение глобального Hermes config без отдельной команды пользователя.

## Проверки

Из source checkout:

```bash
npm test
npm run receipt:mcp-smoke
npm run browser:e2e
npm run model-route:report -- /tmp/nonexistent-cases.jsonl
python3 -m py_compile integrations/hermes/__init__.py integrations/hermes/schemas.py
git diff --check
hermes plugins doctor jev-layer
```

Текущее доказанное состояние: `npm test` — 35/35; MCP receipt smoke и browser fixture E2E проходят; gateway-live model route был записан и успешно связан с execution receipt/report. Это не доказательство автоматического роутинга моделей и не утверждение о real-browser speedup.

## Готовый prompt локальному агенту

```text
Работай только с jev-layer в указанном target surface. Сначала прочитай:
- docs/HERMES-LOCAL-AGENT-HANDOFF.ru.md
- docs/AGENT-IMPLEMENTATION.md

Сохрани host ownership: Jev даёт bounded advisory decision; Hermes владеет registry,
permissions, approval, execution, retry/recovery и финальным результатом. Не добавляй
автоматическое переключение моделей, browser executor, глобальный config write, provider
credential или network publication без отдельного явного требования.

Перед изменением назови source files, installed plugin files и gateway impact. Используй TDD:
сначала узкий offline test, затем implementation, потом npm test + релевантные smoke tests.
Если touch'нуты registration/handler/schema/manifest, синхронизируй plugin copy, прогоняй
hermes plugins doctor jev-layer и попроси /restart. После рестарта сделай live tool call,
запиши/прочитай exact receipt и только затем заявляй, что integration активна.

Не делай git push, npm publish, release или удаление replay/artifact без отдельной команды.
```
