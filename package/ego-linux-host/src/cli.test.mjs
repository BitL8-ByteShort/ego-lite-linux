import test from "node:test";
import assert from "node:assert/strict";
import { parseArguments, resolveSdkPayload } from "../dist/src/cli.js";
test("CLI accepts stdin, -e, file, SDK path with spaces; rejects unknown/extra arguments", () => {
  assert.equal(parseArguments([]).command, "nodejs");
  assert.equal(
    parseArguments(["nodejs", "-e", "console.log(1)"]).code,
    "console.log(1)",
  );
  assert.equal(
    parseArguments(["nodejs", "/tmp/script.mjs"]).file,
    "/tmp/script.mjs",
  );
  assert.equal(
    parseArguments(["nodejs", "--sdk-path", "/tmp/path with spaces/index.js"])
      .sdkPath,
    "/tmp/path with spaces/index.js",
  );
  for (const argv of [["bogus"], ["nodejs", "--bad"], ["status", "extra"]])
    assert.throws(() => parseArguments(argv), /Usage|argument/);
});
test("SDK payload validates bundle and matching guides before launch", async () => {
  await assert.rejects(resolveSdkPayload("/missing/index.js"), /SDK|ENOENT/);
});
test("help does not swallow extra unknown arguments", () => {
  assert.throws(() => parseArguments(["--help", "--bad"]), /Usage/);
});
