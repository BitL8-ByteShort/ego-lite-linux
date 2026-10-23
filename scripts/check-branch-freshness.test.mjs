import test from "node:test";
import assert from "node:assert/strict";
import { checkBranchFreshness } from "./check-branch-freshness.mjs";

function fixture({ upstream = true, fetch = true, ancestor = true } = {}) {
  const calls = [];
  const messages = [];
  const code = checkBranchFreshness({
    runGit(args) {
      calls.push(args);
      return {
        status: (
          args[0] === "remote"
            ? upstream
            : args[0] === "fetch"
              ? fetch
              : ancestor
        )
          ? 0
          : 1,
      };
    },
    log: (message) => messages.push(message),
  });
  return { calls, messages, code };
}

test("fork checks upstream/dev rather than fork origin/dev", () => {
  const result = fixture();
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, [
    ["remote", "get-url", "upstream"],
    ["fetch", "--quiet", "upstream", "dev"],
    ["merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD"],
  ]);
});

test("original upstream checkout falls back to origin/dev", () => {
  const result = fixture({ upstream: false });
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls[1], ["fetch", "--quiet", "origin", "dev"]);
});

test("offline fetch preserves existing skip behavior and never inspects stale FETCH_HEAD", () => {
  const result = fixture({ fetch: false });
  assert.equal(result.code, 0);
  assert.equal(result.calls.length, 2);
  assert.match(result.messages[0], /cannot fetch upstream\/dev/);
});

test("behind branch reports the selected remote and fails", () => {
  for (const upstream of [true, false]) {
    const result = fixture({ upstream, ancestor: false });
    const remote = upstream ? "upstream" : "origin";
    assert.equal(result.code, 1);
    assert.match(
      result.messages.join("\n"),
      new RegExp(`behind ${remote}/dev`),
    );
    assert.match(
      result.messages.join("\n"),
      new RegExp(`git rebase ${remote}/dev`),
    );
  }
});
