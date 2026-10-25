## Summary

Describe the change and why it belongs in its own branch.

## Verification

- [ ] `pnpm verify`
- [ ] `pnpm audit --audit-level high`
- [ ] Design changes: `pnpm weft validate <design>` and `pnpm weft fmt <design> --check`

## Security review

- [ ] No secrets, tokens, customer data, or local-only artifacts are included.
- [ ] The change does not widen filesystem, process, network or agent permissions.
- [ ] Captured HTML, if any, is treated as untrusted and remains sandboxed.
- [ ] Security-sensitive behavior is documented in `SECURITY.md` or `docs/security.md`.

## Notes

Anything reviewers should know, including follow-up branches or deliberate omissions.
