# Routing providers

CLI, stdio MCP, and the Hermes/OMP adapters use the same three providers. Routing, supervision, and browser decisions share provider resolution. The host still owns execution and approval.

| Provider | Default endpoint | Default model | Credentials |
| --- | --- | --- | --- |
| `demo` | None; deterministic word matching, no HTTP | `jev-demo` | None |
| `openrouter` | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.14` | `OPENROUTER_API_KEY` |
| `typesafe` | `https://api.typesafe.ai/v1/systemone` | `jev-1.14.0` | `TYPESAFE_API_KEY` |

Both remote providers send `{ model, state, questions }` with a Choice question and Bearer authentication. They use the [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request) and the [official TypeSafe API](https://docs.typesafe.ai/api), respectively.

TypeSafe is pinned to the [official Jev 1.14 release](https://docs.typesafe.ai/models); `TYPESAFE_MODEL` still overrides it. The upstream `jev-latest` alias currently points to 1.13, so it does not select 1.14. OpenRouter defaults to its verified [Jev 1.14 model ID](https://openrouter.ai/typesafe/jev-1.14); `OPENROUTER_DECISIONS_MODEL` still overrides it. Both providers support PNG/JPEG images and Box with Jev 1.14, using different HTTP image formats.

## Images and Box questions

Both providers advertise `supportsImages = true`. Their `decide({ state, candidates, assets })` and `evaluate({ state, questions, assets })` accept the same optional layer-level `assets` map:

```json
{
  "state": { "screenshot": "frame-6e1d0b7c" },
  "assets": {
    "frame-6e1d0b7c": { "type": "image", "format": "png", "data_base64": "<base64 image bytes>" }
  },
  "questions": {
    "visible": { "type": "noul", "instructions": "Is the target visible in `screenshot`?" },
    "target": { "type": "box", "instructions": "the target in `screenshot`" }
  }
}
```

Use real standard base64, with padding and no whitespace or `data:` prefix. Only inline PNG/JPG/JPEG still images are supported; the adapter never fetches files or URLs. Each asset reference must occur in a string value in `state`, question `instructions`, or `criteria`. Prefer unique references: upstream replaces plain-text matches, including mid-sentence matches, but never object keys. Put a shared image in state once; repeated references expand the image repeatedly upstream.

`normalizeImageAssets(assets)` returns a canonical map (or `{}` when omitted) and rejects invalid map entries, references, base64, format signatures, truncated headers, animated PNGs, and local bounds. Local limits follow the [official image contract](https://docs.typesafe.ai/images): 16 MiB decoded per image, 32 MiB serialized request body, references at most 1,024 UTF-8 bytes each and 65,536 bytes total, width/height 256–1568 pixels each, and at least 78,400 pixels. No artificial image-count or 4 MB proxy limit is imposed. Header inspection is not a complete image decoder: upstream still validates image integrity and its processed/expanded 32 MiB limits. Images are never silently resized.

Direct TypeSafe adds `TypeSafe-Danger-Zone-Images: true` for assets or [Box questions](https://docs.typesafe.ai/primitives/box), without an extra environment switch. These upstream surfaces are experimental. Box requires Jev 1.14 and returns normalized edges plus confidence, even when the target is absent; pair it with Noul (`answer.noul`, not a confidence field) before grounding an action. Hosts retain approval, execution, and screenshot-to-desktop/DPI/crop mapping.

OpenRouter uses the [Multimodal Decisions format](https://openrouter.ai/docs/guides/community/multimodal-decisions): `{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }` parts in `state`, question instructions or criteria. The adapter expands layer asset references into these parts, including references inside longer strings, without replacing object keys or changing question types. PNG remains `image/png`; JPG/JPEG use `image/jpeg`. It does **not** send TypeSafe's top-level `assets` field to OpenRouter. No extra vision flag or direct TypeSafe key is needed.

Live checks on October 15, 2026 against `/api/alpha/decisions` resolved `typesafe/jev-1.14-20261014`: solid-red and solid-blue images were each classified correctly with confidence 1. A screenshot-only red rectangle was grounded through the actual MCP computer tool at `(200, 148)` inside the known rectangle, with visibility 0.97 and Box confidence 0.98; the response required host confirmation and no desktop action was executed. Earlier probes using TypeSafe assets/references with OpenRouter returned `unknown` because they used the wrong image input format; they do not establish lack of OpenRouter vision support.

For Windows PowerShell, with `OPENROUTER_API_KEY` already supplied by your secret store:

```powershell
$env:JEV_LAYER_PROVIDER = "openrouter"
$env:OPENROUTER_DECISIONS_MODEL = "typesafe/jev-1.14"
$env:JEV_COMPUTER_USE = "1"
npm run mcp
```

Restart an already-running MCP server after updating the source/environment. Vision is used when the host supplies `observation.screenshot` to `jev_computer_step`/`jev_browser_step`, or `assets` to `jev_route`; the layer does not capture the screen itself. `JEV_COMPUTER_USE` opts into desktop advice, not image input generally. Browser advice still requires its own enabled setting.

Missing credentials, unsupported image providers, timeouts, HTTP errors, and rejected images fail open through the host's existing caller error path; no retries or autonomous computer executor are added. Image-path transport, HTTP-body, and invalid-JSON error details are redacted so an upstream echo of base64 cannot enter durable error receipts.

## Select a provider

For a stdio MCP process, export the selected provider's API key through your secret store into the harness environment, then choose one command:

```sh
JEV_LAYER_PROVIDER=demo jev mcp
JEV_LAYER_PROVIDER=openrouter jev mcp
JEV_LAYER_PROVIDER=typesafe jev mcp
```

For a single CLI request from the repository root:

```sh
jev cli --provider demo --input examples/route-request.json
jev cli --provider openrouter --input examples/route-request.json
jev cli --provider typesafe --input examples/route-request.json
```

Selection precedence is: request `provider` → CLI `--provider` (CLI only) → `JEV_LAYER_PROVIDER` → `.jev/config.json` `provider` → `demo`. MCP launcher `env` entries count as process environment; update them when switching providers. Hermes and OMP delegate this choice to the CLI instead of forcing `demo`. The Hermes adapter's default process timeout is 10 seconds, allowing either provider's HTTP timeout to complete; `JEV_LAYER_TIMEOUT_S` overrides it.

`jev add <harness> --provider typesafe` generates configuration for TypeSafe in the target workspace. Use `--provider openrouter` or `--provider demo` for the other modes. Keep keys outside generated configuration.

## Endpoints, models, and custom environment names

- TypeSafe: `TYPESAFE_ENDPOINT`, `TYPESAFE_MODEL`.
- OpenRouter: `OPENROUTER_DECISIONS_ENDPOINT`, `OPENROUTER_DECISIONS_MODEL`; optional attribution headers use `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_TITLE`.
- Endpoints are complete request URLs, including `/v1/systemone` or `/api/alpha/decisions`.
- Default HTTP timeouts are 2 seconds for TypeSafe and 5 seconds for OpenRouter. There are no provider retries; failures return control to the host.

The CLI and MCP read `.jev/config.json` from their working directory. `JEV_CONFIG` selects another file. To use secret-store-specific environment names, set only their names in the config:

```json
{
  "provider": "typesafe",
  "providers": {
    "typesafe": {
      "api_key_env": "MY_TYPESAFE_KEY",
      "endpoint_env": "MY_TYPESAFE_ENDPOINT",
      "model_env": "MY_TYPESAFE_MODEL"
    }
  }
}
```

Omitted fields retain the default environment names. A missing configured key returns `fallback` without an HTTP call, even if `TYPESAFE_API_KEY` is set. The same mapping is supported under `providers.openrouter`.

## Verification

`jev doctor` checks configuration and key presence; it does not run inference or validate a key with the provider.

```sh
node --test test/providers.test.mjs test/provider-transports.test.mjs test/images.test.mjs
```

These offline checks cover all three provider selections, CLI/MCP precedence, custom environment names, Hermes/OMP transport, and fail-open behavior. Remote-provider requests use injected responses or a loopback HTTP server with fixture credentials. No paid inference, agent model, or real browser is invoked. Live provider/account availability requires a separately configured environment.
