# Contributing to Weft

Weft is built in small, reviewable branches. Every change starts from an issue, runs on its own branch, passes the full quality gate, receives an adversarial review, and is merged only after explicit maintainer approval.

## Start with an issue

Every bug, feature, task, deferred item and follow-up is tracked in GitHub Issues. Before editing:

```text
1. Search for an existing issue.
2. If none exists, file a bug, feature or task form.
3. Put the issue number in the branch, commits, PR body and changelog.
```

Use `Closes #123` or `Fixes #123` when the PR delivers the whole issue, and `Refs #123` when it delivers part. A CI check rejects a PR whose body has no issue reference, and the repository check rejects tracked agent workflow artifacts.

Issue forms live in `.github/ISSUE_TEMPLATE/`; the PR template lives in `.github/pull_request_template.md`.

## Branch workflow

Create the branch before the first file edit, from the latest primary branch:

```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c feat/<issue-number>-<short-name>
```

```text
feat/<issue>-<short-name>       new user-visible behavior
fix/<issue>-<short-name>        a bug fix
security/<issue>-<short-name>   security hardening or threat-model changes
chore/<issue>-<short-name>      tooling, CI, docs, refactors with no behavior change
docs/<issue>-<short-name>       documentation-only changes
test/<issue>-<short-name>       test-only changes
```

Never edit `main` directly. Do not mix a feature and its follow-up refactor. Keep work branches current by merging or rebasing `main` into them and resolving conflicts there. Do not delete branches without explicit approval.

## Before opening a pull request

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level high
```

`pnpm verify` runs the workflow-rule tests, build, typecheck (including E2E sources), package tests, and validates/canonicalizes the starter design. Browser E2E is a separate required CI job:

```bash
pnpm test:e2e:install   # once per machine
pnpm test:e2e
```

Use browser/E2E checks for editor changes and include exact paths/viewports in the PR. If a change needs a design fixture:

```bash
pnpm weft validate examples/starter.weft
pnpm weft fmt examples/starter.weft --check
```

## Review and approval

- Perform an adversarial self-review of the complete diff: correctness, security boundaries, error handling, edge cases, migrations, backwards compatibility, test coverage and documentation accuracy.
- Use a reviewer subagent when the harness exposes one; otherwise record the structured self-review in the PR.
- The maintainer must approve the specific change set before commit, tag, push or merge. Checks passing is not approval.
- The current repository is maintained by one person, so branch protection requires zero human approvals. This is a documented solo-maintainer exception, not a claim that review is optional. When a second maintainer joins, raise `REQUIRED_APPROVALS` to `1` and require code-owner review.
- Merge only after the required `verify`, `analyze`, `dependency-review`, `e2e` and `CodeQL` checks are green, the branch is current, review findings are fixed, and approval is explicit. Prefer squash merges to keep `main` linear.

## Pull requests

- Keep the PR focused on one issue/outcome.
- Explain what changed, why, and what was deliberately omitted.
- Include validation evidence and review findings/fixes.
- Update tests for the behavior changed.
- Update `README.md`, `SECURITY.md`, `docs/`, CLI/API docs and examples when behavior or commands change.
- Add or supersede an ADR in the same change for significant decisions, and update `docs/HISTORY.md`.
- Update `CHANGELOG.md` with prose under the appropriate category. A release body must match the changelog text.
- Security-sensitive changes need a note in `SECURITY.md` or `docs/security.md`.
- Do not include session transcripts, screenshots, completed task scratch files, downloaded toolchains, dependency caches, credentials or loops.

## Agent workflow artifacts

Keep agent instruction and scratch material out of the repository: `AGENTS.md`, `.cursor/`, `.claude/`, `.pi/`, `SKILL.md`, prompt scratch files, local screenshots and one-off helper scripts belong in the agent directory or a project-local workspace such as `~/.enclave-dev/`, never in the product. The CI workflow check fails if these artifacts are tracked.

## Releases

Release preparation, versioning, tag/release-body assembly, branch cleanup, post-release documentation sweep and verification are documented in [`docs/releasing.md`](docs/releasing.md).

Dependency updates are reviewed deliberately. Automated Dependabot PRs are exempt from the issue-reference check but still go through validation, review and explicit approval. Major-version bumps such as TypeScript 7 get their own migration branch; do not auto-merge them.

## Security

Never commit secrets, tokens, private designs or customer data. Captured HTML is untrusted: keep it sandboxed and never enable scripts in snapshot frames.

Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md), not in a public issue.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT license.
