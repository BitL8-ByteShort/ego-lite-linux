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
test("stop succeeds idempotently when no owned daemon is running", async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp("/tmp/ego-cli-stop-");
  const keys = ["HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR"];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.HOME = dir;
    process.env.XDG_DATA_HOME = join(dir, "data");
    process.env.XDG_CONFIG_HOME = join(dir, "config");
    process.env.XDG_RUNTIME_DIR = join(dir, "run");
    await mkdir(process.env.XDG_RUNTIME_DIR, { mode: 0o700 });
    const { runCli } = await import("../dist/src/cli.js");
    assert.equal(await runCli(["stop", "--profile", "not-running"]), 0);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});
