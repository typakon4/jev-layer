# Routing providers

CLI, stdio MCP, and the Hermes/OMP adapters use the same three providers. Routing, supervision, and browser decisions share provider resolution. The host still owns execution and approval.

| Provider | Default endpoint | Default model | Credentials |
| --- | --- | --- | --- |
| `demo` | None; deterministic word matching, no HTTP | `jev-demo` | None |
| `openrouter` | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` |
| `typesafe` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY` |

Both remote providers send `{ model, state, questions }` with a Choice question and Bearer authentication. They use the [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request) and the [official TypeSafe API](https://docs.typesafe.ai/api), respectively.

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
node --test test/providers.test.mjs test/provider-transports.test.mjs
```

These offline checks cover all three provider selections, CLI/MCP precedence, custom environment names, Hermes/OMP transport, and fail-open behavior. Remote-provider requests use injected responses or a loopback HTTP server with fixture credentials. No paid inference, agent model, or real browser is invoked. Live provider/account availability requires a separately configured environment.
