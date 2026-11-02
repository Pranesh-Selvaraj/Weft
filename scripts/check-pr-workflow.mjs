#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const ISSUE_REFERENCE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#\d+\b/i;
const FORBIDDEN_ARTIFACTS = [
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)\.cursor(\/|$)/i,
  /(^|\/)\.claude(\/|$)/i,
  /(^|\/)\.pi(\/|$)/i,
  /(^|\/)SKILL\.md$/i,
];

function fail(message) {
  console.error(`workflow check failed: ${message}`);
  process.exit(1);
}

function checkIssueReference(body) {
  if (typeof body !== "string" || body.trim().length === 0) {
    fail(
      "PR body is empty. Add an issue reference such as `Closes #123` or `Refs #123`.",
    );
  }
  if (!ISSUE_REFERENCE.test(body)) {
    fail(
      "PR body must reference an issue with `Closes #123`, `Fixes #123`, `Resolves #123` or `Refs #123`.",
    );
  }
}

function checkBranchReference(ref) {
  if (!ref) return;
  if (!/(?:^|[-_/])(\d+)(?:[-_/]|$)/.test(ref)) {
    fail(
      `PR branch ${JSON.stringify(ref)} must include its issue number, for example chore/32-workflow-hardening.`,
    );
  }
}

function checkRepositoryHygiene() {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    fail(`could not list tracked files: ${error instanceof Error ? error.message : String(error)}`);
  }

  const forbidden = tracked.filter((path) =>
    FORBIDDEN_ARTIFACTS.some((pattern) => pattern.test(path)),
  );
  if (forbidden.length > 0) {
    fail(
      `agent workflow artifacts must stay local, not tracked: ${forbidden.join(", ")}`,
    );
  }
}

checkRepositoryHygiene();
checkIssueReference(process.env.PR_BODY);
checkBranchReference(process.env.PR_HEAD_REF);
console.log("workflow check passed: issue reference present; no tracked agent artifacts.");
