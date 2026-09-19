## Summary

<!-- What changed and why? Keep runtime scope explicit. -->

## Checklist

- [ ] This change preserves host ownership of execution, permissions, approvals, retries, and recovery.
- [ ] No secrets, credentials, machine-specific paths, or local state are committed.
- [ ] Schema v1 and adapter compatibility are preserved or migration notes are included.
- [ ] Offline tests or fixtures cover the changed behavior.
- [ ] `npm test`
- [ ] `npm run smoke`
- [ ] `npm run fail-open-smoke`
- [ ] `npm run clean-install-smoke`
- [ ] `npm pack --dry-run`

## Verification output

<!-- Paste concise command results. Redact sensitive output. -->
