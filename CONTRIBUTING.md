# Contributing to Weft

Weft is built in small, reviewable branches. `main` is protected and changes land through pull requests.

## Branch workflow

Create one branch per change:

```text
feat/<short-name>       new user-visible behavior
fix/<short-name>        a bug fix
security/<short-name>   security hardening or threat-model changes
chore/<short-name>      tooling, CI, docs, refactors with no behavior change
docs/<short-name>       documentation-only changes
```

Do not mix a feature and its follow-up refactor in one branch. If a change needs a follow-up, ship the first branch and open the second separately.

## Before opening a pull request

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level high
```

`pnpm verify` runs the build, typecheck, tests, validates the starter design and checks that it is canonical. If you changed a design fixture:

```bash
pnpm weft validate examples/starter.weft
pnpm weft fmt examples/starter.weft --check
```

## Pull requests

- Keep the PR focused on one outcome.
- Explain what changed, why, and what you deliberately did not change.
- Add or update tests for the behavior you changed.
- Security-sensitive changes need a note in `SECURITY.md` or `docs/security.md`.
- Do not include session transcripts, local screenshots, agent scratch files, downloaded toolchains or credentials.

`main` requires the `verify` check. If you are the only maintainer, required human approval is currently zero so you can merge your own PR after CI; raise this to one as soon as another maintainer joins.

## Security

Never commit secrets, tokens, private designs or customer data. Captured HTML is untrusted: keep it sandboxed and never enable scripts in snapshot frames.

Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md), not in a public issue.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT license.
