#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

echo "Configuring repository merge and security settings for $repo"

gh api --method PATCH "repos/$repo" --input - <<'JSON' >/dev/null
{
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": false,
  "delete_branch_on_merge": true,
  "allow_update_branch": true
}
JSON

gh api --method PUT "repos/$repo/actions/permissions/workflow" --input - <<'JSON' >/dev/null
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false
}
JSON

gh api --method PUT "repos/$repo/vulnerability-alerts" >/dev/null
gh api --method PUT "repos/$repo/automated-security-fixes" >/dev/null
gh api --method PUT "repos/$repo/private-vulnerability-reporting" >/dev/null

gh api --method PATCH "repos/$repo" --input - <<'JSON' >/dev/null
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON

echo "Enabled: squash-only merges, branch cleanup, read-only default workflow token,"
echo "vulnerability alerts, Dependabot security updates, private vulnerability reporting,"
echo "secret scanning and push protection."
echo "Run scripts/setup-branch-protection.sh next to protect the branch itself."
