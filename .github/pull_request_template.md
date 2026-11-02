## Issue

<!-- Every PR must name the issue it delivers. The CI workflow enforces this line. -->
Closes #

## Summary

What changed, why, and which user-visible behavior or engineering outcome it delivers.

## Scope

In scope:

- Describe the outcome delivered.

Explicit non-goals / follow-ups:

- Describe what is deliberately excluded or deferred.

## Validation

- [ ] `pnpm verify`
- [ ] `pnpm test:e2e` for editor/browser changes
- [ ] `pnpm audit --audit-level high`
- [ ] Browser/E2E or manual checks (describe exact paths and viewports)
- [ ] Design changes: `pnpm weft validate <design>` and `pnpm weft fmt <design> --check`

Evidence:

```text
Paste commands and results, or screenshots/artifact paths.
```

## Review

- [ ] Adversarial self-review completed (correctness, security boundaries, errors, edge cases, migrations, compatibility, test coverage, docs accuracy).
- [ ] Independent reviewer or reviewer subagent used where available.
- [ ] Solo-maintainer exception documented below if this PR has no independent approval.

Review findings and fixes:

```text
List findings and how they were resolved.
```

## Documentation and release impact

- [ ] `README.md`, `SECURITY.md`, `docs/`, CLI/API docs and examples updated where behavior changed.
- [ ] ADR added or superseded in the same change when a significant decision changed.
- [ ] `docs/HISTORY.md` updated.
- [ ] `CHANGELOG.md` updated with appropriately categorized prose.
- [ ] This PR needs a release; release notes were prepared and will be verified after publishing.

## Security review

- [ ] No secrets, tokens, customer data or local-only workflow artifacts are included.
- [ ] No agent workflow artifacts (`AGENTS.md`, `.cursor/`, `.claude/`, skills, prompt scratch files) are added to the repository.
- [ ] The change does not widen filesystem, process, network or agent permissions.
- [ ] Captured HTML, snapshots and exported untrusted content remain sandboxed/script-free.
- [ ] Security-sensitive behavior is documented in `SECURITY.md` or `docs/security.md`.

## Approval

- [ ] I understand this PR must not be merged until the maintainer explicitly approves this change set.
- [ ] Required checks are green and the branch is up to date with `main`.
