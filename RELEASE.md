# Release checklist

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh-CN.md)

This checklist prepares a public open-source release without publishing or pushing it. Do not run `git push`, create a GitHub release, or run `npm publish` without explicit release approval.

## Before the release commit

- [ ] Confirm package name, ownership, repository metadata, and supported Node versions.
- [ ] Set the intended semantic version in `package.json` and `package-lock.json`.
- [ ] Keep `private: true` until the publish decision is explicit; set it false only in the release commit that is authorized to publish.
- [ ] Confirm [LICENSE](LICENSE) is MIT and the copyright notice is correct.
- [ ] Review `CONTRIBUTING.md` and [SECURITY.md](SECURITY.md).
- [ ] Review schema v1 compatibility in [docs/SCHEMA-VERSIONING.md](docs/SCHEMA-VERSIONING.md).
- [ ] Verify every supported adapter and its documented compatibility range.

## Verification

- [ ] `npm install`
- [ ] `npm test`
- [ ] `npm run smoke`
- [ ] `npm run fail-open-smoke`
- [ ] `npm run clean-install-smoke`
- [ ] Run relevant E2E checks for MCP, receipts, supervision, context filtering, discovery, and browser when changed.
- [ ] Confirm provider-backed tests are either absent from ordinary CI or run only with secret-managed credentials.
- [ ] Confirm fail-open and approval-denial paths still preserve host ownership.

## Package and documentation

- [ ] Run `npm pack --dry-run` and inspect the file list.
- [ ] Ensure no `.env`, credentials, private keys, machine-specific paths, or local state is packaged.
- [ ] Confirm `README.md`, `README.ru.md`, and `README.zh-CN.md` all start with the language links and describe the same public behavior.
- [ ] Confirm the README includes the architecture diagram, Quick Start, supported harnesses, routing, receipts/replay, supervision, context filtering, browser status, and fail-open behavior.
- [ ] Update [CHANGELOG.md](CHANGELOG.md) with user-visible changes and compatibility notes.
- [ ] Add release notes for schema, adapter, or provider changes.

## Tag and release

- [ ] Review the final diff and `npm pack --dry-run` output.
- [ ] Create the version commit.
- [ ] Create an annotated tag matching the package version, for example `v0.1.0`.
- [ ] Push the commit and tag only after explicit approval.
- [ ] Create the GitHub release from the tag only after explicit approval.
- [ ] Verify the release source archive and documentation links.

## npm publish

- [ ] Confirm the package is no longer private and the intended npm account/organization is selected.
- [ ] Confirm npm 2FA/trusted publishing policy and provenance requirements.
- [ ] Run `npm publish --dry-run` and inspect the result.
- [ ] Run `npm publish` only after explicit approval.
- [ ] Install the published version in a clean temporary directory and run the smoke/clean-install checks.
- [ ] Record the published version, tag, release URL, and rollback/contact plan in the changelog or release notes.
