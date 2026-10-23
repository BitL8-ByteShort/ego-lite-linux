import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageArtifact } from "./package.mjs";
import {
  install,
  managedPaths,
  payloadFiles,
  sha256,
  extractArchive,
  verifyPayload,
} from "./install.mjs";
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
async function readArtifact(archive, destination) {
  await fs.mkdir(destination, { recursive: true });
  const root = await extractArchive(archive, destination);
  return {
    archive,
    root,
    manifest: await verifyPayload(root),
    checksum: await sha256(archive),
  };
}
function runtimeDigest(manifest) {
  const entries = Object.entries(manifest.files)
    .filter(
      ([filename]) =>
        filename.startsWith("host/dist/src/") && filename.endsWith(".js"),
    )
    .map(([filename, entry]) => [filename, entry.sha256])
    .sort(([a], [b]) => a.localeCompare(b));
  assert.ok(
    entries.length > 0,
    "Archive must include actual compiled host runtime",
  );
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
function nextVersion(version) {
  return /\d$/.test(version)
    ? version.replace(/\d+$/, (number) => String(Number(number) + 1))
    : `${version}.1`;
}
async function assertStopped(status) {
  for (const pid of [status.daemonPid, status.browserPid]) {
    assert.ok(
      Number.isInteger(pid) && pid > 0,
      "Status identifies owned browser and daemon processes",
    );
    const deadline = Date.now() + 5000;
    while (true) {
      const stat = await fs
        .readFile(`/proc/${pid}/stat`, "utf8")
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!stat || /^\S+ \(.*\) Z /.test(stat)) break;
      if (Date.now() > deadline)
        throw new Error(`Owned process ${pid} remained live after stop`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
const server = createServer((request, response) => {
  if (request.url === "/login")
    response.setHeader(
      "Set-Cookie",
      "installedLogin=yes; Max-Age=3600; Path=/",
    );
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
let upgrade;
let sourceQualification;
const checks = {
  installerContracts: unitCount,
  installedWorkflow: 0,
  laterCliRound: 0,
  versionUpgrade: 0,
  changedCodeUpgrade: 0,
  unexpectedSkips: 0,
};
try {
  artifact = process.env.EGO_LINUX_TEST_ARTIFACT
    ? { archive: path.resolve(process.env.EGO_LINUX_TEST_ARTIFACT) }
    : await packageArtifact({
        outputDir: path.join(temporary, "current artifact"),
      });
  artifact.checksum = await sha256(artifact.archive);
  const current = await readArtifact(
    artifact.archive,
    path.join(temporary, "selected current payload"),
  );
  manifest = current.manifest;
  try {
    const candidate = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(current.archive), "receipt.json"),
        "utf8",
      ),
    );
    if (
      candidate.artifactSha256 === current.checksum &&
      candidate.sdkSha256 === current.manifest.files["sdk/index.js"].sha256 &&
      /^[a-f0-9]{40}$/.test(candidate.codeCommit)
    ) {
      if (current.manifest.gitCommit)
        assert.equal(
          candidate.codeCommit,
          current.manifest.gitCommit,
          "Archive and qualification source commits agree",
        );
      sourceQualification = {
        file: "receipt.json",
        artifactSha256: candidate.artifactSha256,
        codeCommit: candidate.codeCommit,
        evidence:
          "Adjacent qualification receipt matches selected archive and SDK SHA-256",
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const previous = process.env.EGO_LINUX_TEST_PREVIOUS_ARTIFACT
    ? await readArtifact(
        path.resolve(process.env.EGO_LINUX_TEST_PREVIOUS_ARTIFACT),
        path.join(temporary, "previous payload"),
      )
    : current;
  const upgradedArtifact = await packageArtifact({
    hostDir: path.join(current.root, "host"),
    sdkDir: path.join(current.root, "sdk"),
    license: path.join(current.root, "LICENSE"),
    attribution: path.join(current.root, "ATTRIBUTION.md"),
    outputDir: path.join(temporary, "next version artifact"),
    version: nextVersion(current.manifest.version),
    sourceCommit:
      current.manifest.gitCommit || sourceQualification?.codeCommit || null,
  });
  const beforeRuntime = runtimeDigest(previous.manifest);
  const afterRuntime = runtimeDigest(upgradedArtifact.manifest);
  assert.equal(
    afterRuntime,
    runtimeDigest(current.manifest),
    "Next-version payload preserves the exact selected compiled runtime",
  );
  assert.equal(
    upgradedArtifact.manifest.files["sdk/index.js"].sha256,
    current.manifest.files["sdk/index.js"].sha256,
    "Next-version payload preserves the selected SDK",
  );
  const changedRuntimeCode = beforeRuntime !== afterRuntime;
  if (process.env.EGO_LINUX_TEST_PREVIOUS_ARTIFACT)
    assert.ok(
      changedRuntimeCode,
      "An explicit previous artifact must contain different compiled host code",
    );
  assert.notEqual(
    previous.manifest.version,
    upgradedArtifact.manifest.version,
    "Upgrade must switch versioned payload directories",
  );
  upgrade = {
    from: {
      version: previous.manifest.version,
      archiveSha256: previous.checksum,
      gitCommit: previous.manifest.gitCommit,
      runtimeSha256: beforeRuntime,
    },
    to: {
      version: upgradedArtifact.manifest.version,
      archiveSha256: upgradedArtifact.checksum,
      gitCommit: upgradedArtifact.manifest.gitCommit,
      runtimeSha256: afterRuntime,
    },
    selectedCurrentArchiveSha256: current.checksum,
    changedRuntimeCode,
    sameCodeUpgrade: !changedRuntimeCode,
    codeUpgradeQualified: false,
    generationChanged: false,
    statePreserved: [],
  };
  // Neither the installed command nor its runtime can depend on the archive's location.
  const relocated = path.join(temporary, "moved release archive.tar.gz");
  await fs.copyFile(previous.archive, relocated);
  const installed = await install({ artifact: relocated, prefix });
  prerequisites = installed.prerequisites;
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
    const assert = (await import("node:assert/strict")).default;
    const task = await taskSpace(${JSON.stringify(taskName)});
    const page = task.page("p1");
    await page.goto(${JSON.stringify(new URL("login", url).href)});
    assert.match(await page.evaluate(() => document.cookie), /installedLogin=yes/);
    if (!String(await page.snapshot()).includes("Installed workflow")) throw new Error("Installed snapshot failed");
    await page.click("#verify");
    if (await page.evaluate(() => document.querySelector("output").textContent) !== "Verified installed artifact") throw new Error("Installed click failed");
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("installed-upgrade", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("data");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("data", "readwrite");
          transaction.objectStore("data").put("durable", "key");
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
        };
      });
    });
    cliLog("INSTALLED_WORKFLOW_PASS");
  `;
  assert.match(
    (await command(executable, ["nodejs"], workflow)).stdout,
    /INSTALLED_WORKFLOW_PASS/,
  );
  checks.installedWorkflow++;
  const verifyState = `
    assert.match(await page.evaluate(() => document.cookie), /(?:^|; )installedLogin=yes(?:;|$)/);
    assert.equal(await page.evaluate(() => localStorage.getItem("installed")), "yes");
    assert.equal(await page.evaluate(async () => new Promise((resolve, reject) => {
      const request = indexedDB.open("installed-upgrade", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction("data").objectStore("data").get("key");
        get.onsuccess = () => { db.close(); resolve(get.result); };
        get.onerror = () => { db.close(); reject(get.error); };
      };
    })), "durable");
  `;
  const round = `
    const assert = (await import("node:assert/strict")).default;
    const task = await taskSpace(${JSON.stringify(taskName)});
    const page = task.page("p1");
    ${verifyState}
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
  checks.laterCliRound++;
  const beforeStatus = JSON.parse(
    (await command(executable, ["status"])).stdout,
  );
  await command(executable, ["stop"]);
  await assertStopped(beforeStatus);
  const upgraded = await install({
    artifact: upgradedArtifact.archive,
    prefix,
  });
  executable = upgraded.executable;
  assert.equal(
    await fs.readlink(managedPaths(prefix).current),
    upgradedArtifact.manifest.version,
  );
  const upgradedWorkflow = `
    const assert = (await import("node:assert/strict")).default;
    const task = await taskSpace(${JSON.stringify(taskName + " after code upgrade")});
    const page = task.page("p1");
    await page.goto(${JSON.stringify(url)});
    ${verifyState}
    assert.match(String(await page.snapshot()), /Installed workflow/);
    await page.click("#verify");
    assert.equal(await page.evaluate(() => document.querySelector("output").textContent), "Verified installed artifact");
    await task.finish({keep:[]});
    cliLog("INSTALLED_UPGRADE_PASS");
  `;
  assert.match(
    (await command(executable, ["nodejs", "-e", upgradedWorkflow])).stdout,
    /INSTALLED_UPGRADE_PASS/,
  );
  const afterStatus = JSON.parse(
    (await command(executable, ["status"])).stdout,
  );
  assert.notEqual(
    beforeStatus.generation,
    afterStatus.generation,
    "Full code upgrade restart must change the browser generation",
  );
  assert.equal(
    await sha256(artifact.archive),
    artifact.checksum,
    "Selected current artifact must remain unchanged",
  );
  upgrade.generationChanged = true;
  upgrade.codeUpgradeQualified = changedRuntimeCode;
  upgrade.statePreserved = ["persistent cookie", "localStorage", "IndexedDB"];
  checks.versionUpgrade++;
  if (changedRuntimeCode) checks.changedCodeUpgrade++;
  doctor = JSON.parse((await command(executable, ["doctor", "--json"])).stdout);
  await command(executable, ["stop"]);
  await assertStopped(afterStatus);
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
    `Installed real-browser workflow, later round, version upgrade (changed runtime code: ${changedRuntimeCode}), full restart persistence and uninstall retention passed`,
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
          sourceQualification,
          sdkSha256: manifest?.files["sdk/index.js"]?.sha256,
        },
        checks,
        upgrade,
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
