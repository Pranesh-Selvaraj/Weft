import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-pr-workflow.mjs", import.meta.url));

function run(body, headRef) {
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, PR_BODY: body, ...(headRef ? { PR_HEAD_REF: headRef } : {}) },
    encoding: "utf8",
  });
}

test("accepts common issue references", () => {
  for (const body of [
    "Closes #32",
    "Fixes #39\n\nSome details",
    "Refs #34 and Refs #35",
    "resolves #40",
  ]) {
    const result = run(body);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /workflow check passed/);
  }
});

test("rejects a missing issue reference", () => {
  const result = run("## Summary\n\nNo issue link here.");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must reference an issue/);
});

test("rejects an unfilled issue reference placeholder", () => {
  const result = run("Closes #\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must reference an issue/);
});

test("rejects an empty PR body", () => {
  const result = run("");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PR body is empty/);
});

test("requires an issue number in a non-automated branch name", () => {
  const result = run("Closes #32", "chore/workflow-hardening");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must include its issue number/);
});

test("accepts an issue number in the branch name", () => {
  const result = run("Closes #32", "chore/32-workflow-hardening");
  assert.equal(result.status, 0, result.stderr);
});
