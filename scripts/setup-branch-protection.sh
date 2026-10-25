#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
branch="${2:-main}"
checks="${REQUIRED_CHECKS:-verify}"
approvals="${REQUIRED_APPROVALS:-0}"
codeowner_reviews="${REQUIRE_CODEOWNER_REVIEWS:-false}"

if ! [[ "$approvals" =~ ^[0-9]+$ ]]; then
  echo "REQUIRED_APPROVALS must be a non-negative integer." >&2
  exit 2
fi

payload="$(python3 - "$checks" "$approvals" "$codeowner_reviews" <<'PY'
import json
import sys

checks = [check.strip() for check in sys.argv[1].split(",") if check.strip()]
approvals = int(sys.argv[2])
codeowner_reviews = sys.argv[3].lower() == "true"

print(json.dumps({
    "required_status_checks": {
        "strict": True,
        "contexts": checks,
    } if checks else None,
    "enforce_admins": True,
    "required_pull_request_reviews": {
        "dismiss_stale_reviews": True,
        "require_code_owner_reviews": codeowner_reviews,
        "required_approving_review_count": approvals,
        "require_last_push_approval": False,
    },
    "restrictions": None,
    "required_linear_history": True,
    "allow_force_pushes": False,
    "allow_deletions": False,
    "required_conversation_resolution": True,
    "lock_branch": False,
    "allow_fork_syncing": False,
}))
PY
)"

printf '%s\n' "$payload" | gh api \
  --method PUT \
  "repos/$repo/branches/$branch/protection" \
  --input - >/dev/null

gh api "repos/$repo/branches/$branch/protection" | python3 -c '
import json
import sys

protection = json.load(sys.stdin)
checks = (protection.get("required_status_checks") or {}).get("contexts") or []
reviews = protection.get("required_pull_request_reviews") or {}
print("Protected branch:", sys.argv[1] + "/" + sys.argv[2])
print("Required checks:", ", ".join(checks) if checks else "(none)")
print("Approvals required:", reviews.get("required_approving_review_count", 0))
print("Enforce admins:", protection.get("enforce_admins", {}).get("enabled", False))
print("Linear history:", protection.get("required_linear_history", {}).get("enabled", False))
print("Force pushes:", protection.get("allow_force_pushes", {}).get("enabled", False))
print("Deletions:", protection.get("allow_deletions", {}).get("enabled", False))
' "$repo" "$branch"

if [ "$approvals" -eq 0 ]; then
  echo "Note: approvals are 0 for the current solo-maintainer setup. Raise REQUIRED_APPROVALS to 1 when a second maintainer joins." >&2
fi
