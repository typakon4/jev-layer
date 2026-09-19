---
name: jev-route
description: Use Jev for one bounded capability choice when a closed candidate set is already available. Keep permissions, approvals, execution, and recovery in Codex.
---

# Jev route

Use the `jev_route` MCP tool only when the request can be expressed as one bounded choice among supplied capabilities.

1. Build a small candidate list from capabilities Codex can already execute.
2. Include only non-secret intent, candidate metadata, and the minimum context needed.
3. Call `jev_route` once.
4. Treat `fallback`, `no_decision`, and `needs_confirmation` as normal outcomes.
5. Execute `selected` only through the native Codex capability and its existing approval gate.
6. Never interpret a Jev response as permission to bypass Codex policy.

Do not use Jev for open-ended planning, coding, research, recovery, or arbitrary tool execution.
