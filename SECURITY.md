# Security policy

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

## Scope and trust model

jev-layer is a routing and evidence layer, not a security boundary. It can return a bounded recommendation and persist a receipt; it does not grant permissions, execute host capabilities, approve actions, isolate a process, or validate that a provider is truthful.

The host remains the source of truth for:

- capability availability and permissions;
- approval and confirmation decisions;
- native execution, retries, recovery, and cancellation;
- final results and side effects.

Adapters must fail open to the host's normal path when Jev is disabled, unavailable, inconclusive, or returns an error. A Jev response must never be treated as authorization by itself.

## API keys and credentials

- Keep provider keys in process environment variables or user-owned secret storage.
- Never commit `.env` files, API keys, bearer tokens, private keys, provider headers, or copied secret-bearing requests.
- Do not put credentials in `context`, capabilities, prompts, replay fixtures, issue reports, or receipts.
- Use the secret-free `demo` provider for local tests and ordinary pull requests.
- If a credential is exposed, revoke it immediately, remove it from active systems, and report the incident privately.

Supported provider environment names include `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY`. The names may appear in configuration examples; their values must not.

## Logs, receipts, and replay data

Routing cases and execution receipts can contain capability names, prompts or bounded context, host results, errors, URLs, timing, and provider metadata. Treat `.jev/replay/cases.jsonl` and CI logs as potentially sensitive.

Before sharing logs or fixtures:

1. remove API keys, tokens, cookies, authorization headers, private paths, and personal data;
2. remove sensitive prompt/context and host output;
3. retain only the smallest correlation and status fields needed to reproduce the issue.

Receipt fields are bounded, but bounded data can still be confidential. Do not use receipts as an authorization ledger.

## Prompt injection and provider limitations

Provider output is untrusted data. Prompt injection, malicious capability descriptions, misleading browser text, compromised providers, and incorrect confidence values can cause a bad recommendation. jev-layer does not claim to detect or defeat prompt injection.

The host must validate selected ids against its current registry, enforce permissions and approval, and reject stale, unavailable, or malformed selections. The browser fast-path is experimental, opt-in, and must not be used as a security control.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability or include secrets in a report. Use a private GitHub Security Advisory for the repository when that channel is available. If it is not available, contact the project maintainers through the private contact channel listed by the repository owner and provide:

- affected version or commit;
- minimal reproduction;
- impact and required permissions;
- whether credentials or personal data were exposed;
- a safe contact for coordinated follow-up.

We will acknowledge a report when practicable, validate the impact, coordinate a fix or mitigation, and publish a release note after a fix is available. Please allow maintainers reasonable time for coordinated disclosure.
