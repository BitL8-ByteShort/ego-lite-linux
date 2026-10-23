import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageArtifact } from "./package.mjs";
import { install, managedPaths, payloadFiles, sha256 } from "./install.mjs";
import { uninstall } from "./uninstall.mjs";

const hostDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repository = path.resolve(hostDir, "../..");
const unit = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "scripts/install.test.mjs"],
  { cwd: hostDir, encoding: "utf8" },
);
process.stdout.write(unit.stdout || "");
process.stderr.write(unit.stderr || "");
const unitCount = Number(/^# tests (\d+)$/m.exec(unit.stdout)?.[1]);
const unitSkips = Number(/^# skipped (\d+)$/m.exec(unit.stdout)?.[1]);
if (unit.status !== 0) throw new Error("Installer contract tests failed");
assert.ok(
  unitCount > 0 && unitSkips === 0,
  "Installer suite must run all contracts",
);
if (process.platform !== "linux")
  throw new Error(
    "Actual installed browser qualification requires Linux; installer contract tests passed on this platform",
  );

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ego-installed-"));
const prefix = path.join(temporary, "unrelated install prefix with spaces");
const workspace = path.join(temporary, "unrelated working directory");
const runtime = path.join(temporary, "run");
await fs.mkdir(workspace);
await fs.mkdir(runtime, { mode: 0o700 });
const env = {
  ...process.env,
  EGO_LINUX_AGENT_ID: "installed-artifact-qualification",
  EGO_LINUX_HEADLESS: process.env.EGO_LINUX_HEADLESS || "1",
  XDG_DATA_HOME: path.join(temporary, "data"),
  XDG_CONFIG_HOME: path.join(temporary, "config"),
  XDG_RUNTIME_DIR: runtime,
};
function command(executable, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 90000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            `${path.basename(executable)} ${args[0]} failed (${signal || code}): ${stderr}\n${stdout}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    "<!doctype html><title>Installed workflow</title><h1>Installed workflow</h1><button id=\"verify\" onclick=\"document.querySelector('output').textContent='Verified installed artifact';localStorage.setItem('installed','yes')\">Verify installation</button><output>Waiting</output>",
  );
});
let executable;
let failure;
let cleanup = false;
let artifact;
let doctor;
let manifest;
let prerequisites;
try {
  artifact = process.env.EGO_LINUX_TEST_ARTIFACT
    ? { archive: path.resolve(process.env.EGO_LINUX_TEST_ARTIFACT) }
    : await packageArtifact();
  artifact.checksum = await sha256(artifact.archive);
  // Neither the installed command nor its runtime can depend on the archive's location.
  const relocated = path.join(temporary, "moved release archive.tar.gz");
  await fs.copyFile(artifact.archive, relocated);
  const installed = await install({ artifact: relocated, prefix });
  prerequisites = installed.prerequisites;
  manifest = JSON.parse(
    await fs.readFile(path.join(installed.payload, "manifest.json"), "utf8"),
  );
  executable = installed.executable;
  await fs.unlink(relocated);
  await command(executable, ["--help"]);
  assert.match(
    (await command(executable, ["skill"])).stdout,
    /taskSpace|TaskSpace/,
  );
  for (const relative of await payloadFiles(installed.payload)) {
    assert.equal(
      (await fs.lstat(path.join(installed.payload, relative))).isSymbolicLink(),
      false,
    );
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const taskName = `installed qualification ${Date.now()}`;
  const workflow = `
    const task = await taskSpace(${JSON.stringify(taskName)});
    const page = task.page("p1");
    await page.goto(${JSON.stringify(url)});
    if (!String(await page.snapshot()).includes("Installed workflow")) throw new Error("Installed snapshot failed");
    await page.click("#verify");
    if (await page.evaluate(() => document.querySelector("output").textContent) !== "Verified installed artifact") throw new Error("Installed click failed");
    cliLog("INSTALLED_WORKFLOW_PASS");
  `;
  assert.match(
    (await command(executable, ["nodejs"], workflow)).stdout,
    /INSTALLED_WORKFLOW_PASS/,
  );
  const round = `
    const task = await taskSpace(${JSON.stringify(taskName)});
    if (await task.page("p1").evaluate(() => localStorage.getItem("installed")) !== "yes") throw new Error("Later installed round lost state");
    await task.finish({keep:[]});
    cliLog("INSTALLED_ROUND_PASS");
  `;
  assert.match(
    (
      await command(executable, [
        "nodejs",
        "--sdk-path",
        path.join(installed.payload, "sdk/index.js"),
        "-e",
        round,
      ])
    ).stdout,
    /INSTALLED_ROUND_PASS/,
  );
  doctor = JSON.parse((await command(executable, ["doctor", "--json"])).stdout);
  await command(executable, ["stop"]);
  executable = undefined;
  const data = path.join(env.XDG_DATA_HOME, "ego-lite-linux");
  const before = await fs.readdir(data);
  assert.ok(before.length > 0, "Browser qualification created profile data");
  assert.equal((await uninstall({ prefix })).retained.length, 0);
  assert.deepEqual(await fs.readdir(data), before);
  await assert.rejects(fs.lstat(managedPaths(prefix).current), {
    code: "ENOENT",
  });
  cleanup = true;
  console.log(
    "Installed real-browser workflow, later round, relocation and uninstall retention passed",
  );
} catch (error) {
  failure = error;
} finally {
  if (executable) {
    try {
      await command(executable, ["stop"]);
      cleanup = true;
    } catch (error) {
      failure ||= error;
    }
  }
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  const output = path.join(repository, "artifacts/linux");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(
    path.join(output, "install-receipt.json"),
    `${JSON.stringify(
      {
        kind: "real Linux installed-artifact workflow",
        timestamp: new Date().toISOString(),
        os: {
          platform: process.platform,
          release: os.release(),
          arch: process.arch,
          distribution: await fs
            .readFile("/etc/os-release", "utf8")
            .catch(() => "unavailable"),
        },
        node: process.version,
        artifact: artifact && {
          filename: path.basename(artifact.archive),
          sha256: artifact.checksum,
          gitCommit: manifest?.gitCommit,
          sdkSha256: manifest?.files["sdk/index.js"]?.sha256,
        },
        checks: {
          installerContracts: unitCount,
          installedWorkflow: 1,
          laterCliRound: 1,
          unexpectedSkips: 0,
        },
        doctor,
        prerequisites,
        passed: !failure,
        cleanup,
        failure: failure?.message,
      },
      null,
      2,
    )}\n`,
  );
  if (cleanup || !executable)
    await fs.rm(temporary, { recursive: true, force: true });
}
if (failure) throw failure;
