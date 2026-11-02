# Release process

Releases are criteria-driven. Do not put calendar dates or duration estimates in plans, issues, changelog entries or release notes.

## Preconditions

- Every shipped issue is linked from the change set and has its final evidence.
- `main` is clean, linear and green.
- `pnpm verify` and `pnpm audit --audit-level high` pass.
- Browser/E2E, design validation and security checks relevant to the release pass.
- The working tree contains no agent artifacts, local screenshots, downloaded toolchains or untracked design files.

## Prepare the changelog

1. Move shipped entries out of `Unreleased` under the right Keep a Changelog heading: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.
2. Write prose that states the user-visible effect and explains the cause of each fix.
3. Do not substitute forge-generated “What's Changed”, PR lists or commit logs for the notes.
4. Keep each bullet/paragraph on one line; do not hard-wrap.
5. Reference concrete issues, advisories or upstream releases where they exist.

## Prepare the release body

The release body must contain the same detailed text as the changelog entry for that version. It may add installation and upgrade notes, but it must not replace the changelog with a generated PR list.

Check:

```bash
pnpm verify
pnpm audit --audit-level high
git status --short
```

## Publish

After explicit maintainer approval:

1. Set the version and update the changelog heading from `Unreleased` to the chosen version.
2. Commit the release preparation on a release branch and open a PR linked to the release issue.
3. Merge only after checks and approval.
4. Tag the merge on `main` and push the tag.
5. Publish the forge release using the prepared body.
6. Open the published release page and verify it renders the prepared body, not a generated PR list.
7. Verify the tag points at the intended commit and the changelog and release body match.

## Post-release documentation sweep

A release is not complete until the repository documentation matches what shipped:

- `README.md`: features, setup, commands, configuration, limitations.
- `SECURITY.md`, `.env.example`, deployment/compose/Helm docs.
- `docs/architecture.md`, `docs/HISTORY.md`, ADR index and any affected guides.
- Verify command names, environment variables, endpoint paths, flags, defaults and limits; remove stale claims.
- Include the documentation update in the release change set and mention it in the notes.
- Close shipped issues with the release tag and a note on what shipped; keep partially delivered issues open with status.
- File issues for anything deferred in the release notes or phase report.

## Branches and dependencies

- Merged branches may be deleted only after explicit approval.
- Review Dependabot PRs deliberately. Major updates get their own migration branch; never auto-merge them.
- If branch cleanup is not approved, record the retained branches in the release issue rather than silently leaving them.

## Rollback

If a published release is wrong, do not rewrite the changelog or tag history. Publish a corrected release or an explicit superseding note, link the affected issues, and document the corrective action in `docs/HISTORY.md`.
