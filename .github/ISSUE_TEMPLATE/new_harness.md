---
name: New harness request
about: Propose support for an agent harness
labels: harness
---

## Harness

Name, project URL, supported versions, and transport (CLI, stdio MCP, or other).

## Adapter boundary

How will the harness provide capabilities, call `jev_route`, preserve `correlation_id`, execute natively, and call `jev_record_execution`?

## Ownership

Explain how native permissions, approval, retries, recovery, and final results remain in the host.

## Fixture and compatibility

- Secret-free smoke fixture:
- Supported Node/Python/runtime versions:
- Fail-open behavior:
- Configuration snippet:
