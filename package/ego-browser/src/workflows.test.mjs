import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function workflow(name) {
  return readFileSync(
    new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
    "utf8",
  );
}

function releaseGuards(github, source = workflow("ci")) {
  source = source.replace(/\r\n/g, "\n");
  const expressions = [
    source.match(/SHOULD_RELEASE: \$\{\{\s*(.*?)\s*\}\}/)?.[1],
    source.match(/^  release:\n    if: (.+)$/m)?.[1],
  ];
  return expressions.map((expression) => {
    assert.ok(expression, "release guard must be present");
    // These workflow guards use the shared JS/GitHub expression subset.
    return new Function("github", "startsWith", `return (${expression});`)(
      github,
      (value, prefix) => value.toLowerCase().startsWith(prefix.toLowerCase()),
    );
  });
}

test("branch pushes and pull requests do not package or publish releases", () => {
  for (const branch of ["dev", "main", "2.0.0-beta-dev"]) {
    assert.deepEqual(
      releaseGuards({
        event_name: "push",
        ref: `refs/heads/${branch}`,
        ref_name: branch,
      }),
      [false, false],
      branch,
    );
  }
  assert.deepEqual(
    releaseGuards({
      event_name: "pull_request",
      ref: "refs/pull/1/merge",
      ref_name: "1/merge",
    }),
    [false, false],
  );
});

test("beta and stable tag pushes retain both release guards", () => {
  for (const tag of ["v2.0.0-beta.9", "v2.0.0"]) {
    assert.deepEqual(
      releaseGuards({
        event_name: "push",
        ref: `refs/tags/${tag}`,
        ref_name: tag,
      }),
      [true, true],
      tag,
    );
  }
});

function runSourceGuard(branch, source = workflow("main-pr-source")) {
  source = source.replace(/\r\n/g, "\n");
  const script = source.split("        run: |\n")[1];
  assert.ok(script, "source guard must have a shell step");
  const env = { ...process.env };
  delete env.HEAD_REF;
  for (const match of source.matchAll(
    /^          (\w+): \$\{\{ github\.head_ref \}\}$/gm,
  )) {
    env[match[1]] = branch;
  }
  return spawnSync(
    "bash",
    ["-e", "-c", script.replaceAll("${{ github.head_ref }}", branch)],
    { env, encoding: "utf8", timeout: 5000 },
  );
}

test("main source guard allows dev and rejects other branches", () => {
  assert.equal(runSourceGuard("dev").status, 0);
  assert.equal(runSourceGuard("feature/change").status, 1);
});

test("main source guard treats shell syntax in branch names as data", () => {
  const directory = mkdtempSync(join(tmpdir(), "ego-branch-name-"));
  const marker = join(directory, "unexpected-command");
  try {
    const shellMarker = marker.replaceAll("\\", "/");
    const result = runSourceGuard(`feature/$(touch\${IFS}${shellMarker})`);
    assert.equal(result.status, 1);
    assert.equal(existsSync(marker), false, "branch name executed a command");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CRLF workflows preserve release guard decisions", () => {
  const source = workflow("ci").replace(/\r?\n/g, "\r\n");
  for (const [event_name, ref, expected] of [
    ["push", "refs/heads/dev", false],
    ["pull_request", "refs/pull/1/merge", false],
    ["push", "refs/tags/v2.0.0", true],
    ["push", "refs/tags/v2.0.0-beta.9", true],
  ]) {
    assert.deepEqual(releaseGuards({ event_name, ref }, source), [
      expected,
      expected,
    ]);
  }
});

test("CRLF source guards still execute allow and reject paths", () => {
  const source = workflow("main-pr-source").replace(/\r?\n/g, "\r\n");
  assert.equal(runSourceGuard("dev", source).status, 0);
  assert.equal(runSourceGuard("feature/change", source).status, 1);
});
