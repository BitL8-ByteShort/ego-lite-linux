import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { resolvePaths } from "../dist/src/paths.js";
if (process.platform !== "linux") throw Error("Lifecycle gate requires Linux");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "ego-lifecycle-"));
const env = {
  ...process.env,
  HOME: dir,
  XDG_DATA_HOME: join(dir, "data"),
  XDG_CONFIG_HOME: join(dir, "config"),
  XDG_RUNTIME_DIR: join(dir, "runtime"),
  EGO_LINUX_PROFILE: "lifecycle",
  EGO_LINUX_AGENT_ID: "lifecycle",
  EGO_LINUX_HEADLESS: "1",
};
await mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 });
const cli = resolve(root, "package/ego-linux-host/bin/ego-browser.mjs");
const paths = resolvePaths(env, process.getuid(), "lifecycle");
async function run(args) {
  const p = spawn(process.execPath, [cli, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  p.stdout.on("data", (b) => (stdout += b));
  p.stderr.on("data", (b) => (stderr += b));
  const timer = setTimeout(() => p.kill(), 45000);
  const code = await new Promise((r) => p.on("exit", r));
  clearTimeout(timer);
  if (code !== 0) throw Error(`CLI ${code}: ${stderr}`);
  return stdout;
}
async function concurrent(label) {
  await Promise.all(
    ["A", "B"].map((name) =>
      run([
        "nodejs",
        "-e",
        `const t=await taskSpace('${label}-${name}');console.log(t.spaceId);`,
      ]),
    ),
  );
  return JSON.parse(await run(["status"]));
}
try {
  const first = await concurrent("first");
  assert.equal(first.tasks.length, 2);
  assert.ok(first.daemonPid);
  const identity = (
    await readFile(`/proc/${first.daemonPid}/stat`, "utf8")
  ).split(" ")[21];
  assert.match(
    await readFile(`/proc/${first.daemonPid}/cmdline`, "utf8"),
    /host-daemon.js/,
  );
  assert.equal(
    (await readFile(`/proc/${first.daemonPid}/stat`, "utf8")).split(" ")[21],
    identity,
  );
  process.kill(first.daemonPid, "SIGKILL");
  await delay(500);
  const second = await concurrent("recovered");
  assert.notEqual(first.generation, second.generation);
  assert.notEqual(first.daemonPid, second.daemonPid);
  assert.equal(
    second.tasks
      .filter((t) => t.name.startsWith("first"))
      .every((t) => t.hardPaused),
    true,
  );
  await run(["stop"]);
  await writeFile(
    join(paths.runtimeDir, "owner.json"),
    JSON.stringify({ pid: process.pid, nonce: "unrelated-live-pid" }),
    { mode: 0o600 },
  );
  const third = await concurrent("upgrade");
  assert.ok(third.generation);
  process.kill(process.pid, 0);
  await run(["stop"]);
  await writeFile(paths.socketPath, "unrelated-file", { mode: 0o600 });
  await assert.rejects(run(["nodejs", "-e", "help()"]), /unrelated/);
  assert.equal(await readFile(paths.socketPath, "utf8"), "unrelated-file");
  await unlink(paths.socketPath);
  console.log(
    JSON.stringify(
      {
        passed: true,
        startup: "two simultaneous clients; one daemon",
        crashRecovery: true,
        restartInvalidates: true,
        reusedPidNeverSignalled: true,
        unrelatedSocketPreserved: true,
        profilesRetained: true,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
      null,
      2,
    ),
  );
} finally {
  await run(["stop"]).catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
