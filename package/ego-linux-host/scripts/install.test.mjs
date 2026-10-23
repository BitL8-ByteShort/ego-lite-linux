import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  install as installProduct,
  extractArchive,
  verifyPayload,
  managedPaths,
  desktopContent,
  sha256,
  checkLinuxPrerequisites,
} from "./install.mjs";
import { uninstall } from "./uninstall.mjs";
import { packageArtifact } from "./package.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// File/transaction fixtures do not depend on the runner's installed browser.
// Dedicated prerequisite tests below still exercise failed/old/missing probes.
async function install(options) {
  const env = options.env || {
    ...process.env,
    EGO_LINUX_CHROME_PATH: await fakeBrowser(path.dirname(options.prefix)),
  };
  return installProduct({ ...options, env });
}

async function temporary(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "ego-install-tests-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fixture(root, version = "0.1.0-dev.0") {
  const hostDir = path.join(root, `source host ${version}`);
  const sdkDir = path.join(root, `source sdk ${version}`);
  for (const directory of ["bin", "dist/src", "assets"])
    await fs.mkdir(path.join(hostDir, directory), { recursive: true });
  for (const directory of [
    "ego-browser",
    "agent-skills/ego-browser/learnings/fixture",
  ])
    await fs.mkdir(path.join(sdkDir, directory), { recursive: true });
  await fs.writeFile(
    path.join(hostDir, "package.json"),
    JSON.stringify({ version, type: "module" }),
  );
  await fs.writeFile(
    path.join(hostDir, "dist/src/cli.js"),
    `import fs from 'node:fs/promises';\nexport async function runCli(args) { if(args[0]==='skill') console.log(await fs.readFile(new URL('../../../sdk/ego-browser/SKILL.linux.md',import.meta.url),'utf8')); else console.log(${JSON.stringify(version)},JSON.stringify(args)); return 0; }\n`,
  );
  for (const name of ["ego-browser", "ego-lite"]) {
    await fs.writeFile(
      path.join(hostDir, `bin/${name}.mjs`),
      "#!/usr/bin/env node\nimport {runCli} from '../dist/src/cli.js'; process.exitCode=await runCli(process.argv.slice(2));\n",
      { mode: 0o755 },
    );
  }
  await fs.copyFile(
    path.join(here, "../assets/ego-lite-linux.desktop"),
    path.join(hostDir, "assets/ego-lite-linux.desktop"),
  );
  await fs.writeFile(
    path.join(sdkDir, "index.js"),
    "export async function runMain(){}\n",
  );
  await fs.writeFile(
    path.join(sdkDir, "ego-browser/SKILL.linux.md"),
    `fixture guide ${version}\n`,
  );
  await fs.writeFile(
    path.join(sdkDir, "agent-skills/ego-browser/SKILL.md"),
    "fixture entry skill\n",
  );
  await fs.writeFile(
    path.join(
      sdkDir,
      "agent-skills/ego-browser/learnings/fixture/manifest.json",
    ),
    "{}\n",
  );
  const license = path.join(root, "LICENSE");
  await fs.writeFile(license, "MIT test fixture\n");
  return packageArtifact({
    hostDir,
    sdkDir,
    license,
    outputDir: path.join(root, "archives with spaces"),
    attribution: path.join(root, "absent"),
  });
}

function execute(prefix, ...args) {
  return spawnSync(path.join(prefix, "bin/ego-browser"), args, {
    encoding: "utf8",
    cwd: os.tmpdir(),
  });
}

test("archive installs under a prefix with spaces, moves independently, repeats, and retains data on uninstall", async (t) => {
  const root = await temporary(t);
  const archive = await fixture(root);
  const extracted = path.join(root, "extracted elsewhere");
  await fs.mkdir(extracted);
  const payload = await extractArchive(archive.archive, extracted);
  assert.equal((await verifyPayload(payload)).version, "0.1.0-dev.0");
  const moved = path.join(root, "moved release '$() with spaces");
  await fs.rename(payload, moved);
  const prefix = path.join(root, "user prefix '$() with spaces");
  const result = await install({ artifact: moved, prefix });
  await fs.rm(moved, { recursive: true });
  await fs.rm(path.join(root, "source host 0.1.0-dev.0"), { recursive: true });
  await fs.rm(path.join(root, "source sdk 0.1.0-dev.0"), { recursive: true });
  assert.equal(execute(prefix, "hello", "argument with spaces").status, 0);
  assert.match(execute(prefix, "hello").stdout, /0\.1\.0-dev\.0/);
  assert.match(execute(prefix, "skill").stdout, /fixture guide 0\.1\.0-dev\.0/);
  assert.equal(
    await fs.readFile(managedPaths(prefix).desktop, "utf8"),
    desktopContent(prefix),
  );
  assert.equal(
    (await install({ artifact: archive.archive, prefix })).version,
    result.version,
  );
  const data = path.join(
    root,
    "XDG data",
    "ego-lite-linux",
    "profiles",
    "default",
    "Cookies",
  );
  await fs.mkdir(path.dirname(data), { recursive: true });
  await fs.writeFile(data, "controlled fixture state");
  const removal = await uninstall({ prefix });
  assert.equal(removal.retained.length, 0);
  assert.equal(await fs.readFile(data, "utf8"), "controlled fixture state");
  await assert.rejects(fs.lstat(path.join(prefix, "bin/ego-browser")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.lstat(managedPaths(prefix).root), { code: "ENOENT" });
  assert.deepEqual((await uninstall({ prefix })).removed, []);
});

test("upgrade rolls back launcher, current payload and desktop if commit fails", async (t) => {
  const root = await temporary(t);
  const first = await fixture(root);
  const second = await fixture(root, "0.2.0-dev.1");
  const prefix = path.join(root, "prefix");
  await install({ artifact: first.archive, prefix });
  await assert.rejects(
    install({
      artifact: second.archive,
      prefix,
      afterCommit: () => {
        throw new Error("simulated commit failure");
      },
    }),
    /simulated commit failure/,
  );
  assert.equal(await fs.readlink(managedPaths(prefix).current), "0.1.0-dev.0");
  assert.match(execute(prefix, "skill").stdout, /guide 0\.1\.0-dev\.0/);
  await assert.rejects(
    fs.lstat(path.join(managedPaths(prefix).root, "0.2.0-dev.1")),
    { code: "ENOENT" },
  );
  await install({ artifact: second.archive, prefix });
  assert.match(execute(prefix, "skill").stdout, /guide 0\.2\.0-dev\.1/);
  assert.equal(await fs.readlink(managedPaths(prefix).current), "0.2.0-dev.1");
});

test("unrelated launcher, desktop and install roots are never overwritten or deleted", async (t) => {
  const root = await temporary(t);
  const { archive } = await fixture(root);
  for (const conflict of ["launcher", "desktop", "root"]) {
    const prefix = path.join(root, conflict);
    const paths = managedPaths(prefix);
    const filename =
      conflict === "launcher"
        ? paths.launchers[0].filename
        : conflict === "desktop"
          ? paths.desktop
          : paths.owner;
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, "unrelated content");
    await assert.rejects(install({ artifact: archive, prefix }), /Refusing/);
    assert.equal(await fs.readFile(filename, "utf8"), "unrelated content");
  }
});

test("modified checksums, extra files and symlinks reject installation before current changes", async (t) => {
  const root = await temporary(t);
  const { archive } = await fixture(root);
  const prefix = path.join(root, "prefix");
  await install({ artifact: archive, prefix });
  for (const variant of ["checksum", "extra", "symlink"]) {
    const extracted = path.join(root, variant);
    await fs.mkdir(extracted);
    const payload = await extractArchive(archive, extracted);
    if (variant === "checksum")
      await fs.appendFile(path.join(payload, "sdk/index.js"), "tampered");
    if (variant === "extra")
      await fs.writeFile(path.join(payload, "extra"), "unlisted");
    if (variant === "symlink")
      await fs.symlink("/tmp", path.join(payload, "foreign"));
    await assert.rejects(
      install({ artifact: payload, prefix }),
      /checksum mismatch|inventory|symlinks/,
    );
    assert.match(execute(prefix, "skill").stdout, /guide 0\.1\.0-dev\.0/);
  }
});

test("uninstall retains replaced commands and unexpected files", async (t) => {
  const root = await temporary(t);
  const { archive } = await fixture(root);
  const prefix = path.join(root, "prefix");
  const installed = await install({ artifact: archive, prefix });
  const launcher = path.join(prefix, "bin/ego-browser");
  await fs.unlink(launcher);
  await fs.writeFile(launcher, "user replacement");
  const extra = path.join(installed.payload, "user-note.txt");
  await fs.writeFile(extra, "keep me");
  const result = await uninstall({ prefix });
  assert.ok(result.retained.includes(launcher));
  assert.ok(result.retained.includes(installed.payload));
  assert.equal(await fs.readFile(launcher, "utf8"), "user replacement");
  assert.equal(await fs.readFile(extra, "utf8"), "keep me");
});

test("archive extraction rejects symlinks instead of following them outside staging", async (t) => {
  const root = await temporary(t);
  const source = path.join(root, "evil");
  await fs.mkdir(source);
  await fs.symlink("../escape", path.join(source, "link"));
  const archive = path.join(root, "evil.tar.gz");
  assert.equal(
    spawnSync("tar", ["-czf", archive, "-C", root, "evil"]).status,
    0,
  );
  const destination = path.join(root, "out");
  await fs.mkdir(destination);
  await assert.rejects(
    extractArchive(archive, destination),
    /unsupported links/,
  );
  await assert.rejects(fs.lstat(path.join(root, "escape")), { code: "ENOENT" });
});

test("versioned archive has matching external checksum and complete manifest", async (t) => {
  const root = await temporary(t);
  const result = await fixture(root);
  assert.equal(result.checksum, await sha256(result.archive));
  assert.match(
    await fs.readFile(`${result.archive}.sha256`, "utf8"),
    new RegExp(`^${result.checksum}  ego-lite-linux-`),
  );
  assert.ok(
    result.manifest.files[
      "sdk/agent-skills/ego-browser/learnings/fixture/manifest.json"
    ],
  );
  assert.ok(
    !Object.keys(result.manifest.files).some((name) =>
      name.includes("node_modules"),
    ),
  );
});

test("first-install failure leaves no managed payload and --no-desktop omits desktop integration", async (t) => {
  const root = await temporary(t);
  const { archive } = await fixture(root);
  const prefix = path.join(root, "prefix");
  await assert.rejects(
    install({
      artifact: archive,
      prefix,
      afterCommit: () => {
        throw new Error("first installation failed");
      },
    }),
    /first installation failed/,
  );
  await assert.rejects(fs.lstat(managedPaths(prefix).root), { code: "ENOENT" });
  await assert.rejects(fs.lstat(path.join(prefix, "bin/ego-browser")), {
    code: "ENOENT",
  });
  await install({ artifact: archive, prefix, desktop: false });
  await assert.rejects(fs.lstat(managedPaths(prefix).desktop), {
    code: "ENOENT",
  });
  assert.equal(execute(prefix, "skill").status, 0);
});

function tarHeader(name) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write("00000000000\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

test("archive traversal, absolute paths and duplicate entries are rejected", async (t) => {
  const root = await temporary(t);
  for (const names of [
    ["../escape"],
    ["/absolute"],
    ["payload/file", "payload/file"],
  ]) {
    const destination = await fs.mkdtemp(path.join(root, "extract-"));
    const archive = `${destination}.tar.gz`;
    await fs.writeFile(
      archive,
      gzipSync(Buffer.concat([...names.map(tarHeader), Buffer.alloc(1024)])),
    );
    await assert.rejects(
      extractArchive(archive, destination),
      /Unsafe or duplicate archive path/,
    );
  }
  await assert.rejects(fs.lstat(path.join(root, "escape")), { code: "ENOENT" });
});

async function fakeBrowser(
  root,
  { version = "Chromium 156.0.8078.47", status = 0 } = {},
) {
  const executable = path.join(
    root,
    `fake browser ${Math.random().toString(16).slice(2)}.mjs`,
  );
  await fs.writeFile(
    executable,
    `#!/usr/bin/env node\nif(process.argv[2]!=="--version") process.exit(2); console.log(${JSON.stringify(version)}); process.exit(${status});\n`,
    { mode: 0o755 },
  );
  return executable;
}

function prerequisiteProbe(
  executable,
  flockResult = { status: 0, stdout: "flock from util-linux 2.38.1\n" },
) {
  const calls = [];
  return {
    calls,
    options: {
      platform: "linux",
      env: { ...process.env, EGO_LINUX_CHROME_PATH: executable },
      run(command, args, options) {
        calls.push([command, args]);
        return command === "/usr/bin/flock"
          ? flockResult
          : spawnSync(command, args, options);
      },
    },
  };
}

test("Linux prerequisite probe reports actual browser/flock versions and does not claim a sandbox probe", async (t) => {
  const root = await temporary(t);
  const executable = await fakeBrowser(root);
  const probe = prerequisiteProbe(executable);
  const result = await checkLinuxPrerequisites(probe.options);
  assert.equal(result.browser.executable, executable);
  assert.equal(result.browser.version, "Chromium 156.0.8078.47");
  assert.equal(result.browser.testedGeneration, true);
  assert.equal(result.flock.version, "flock from util-linux 2.38.1");
  assert.equal(result.sandbox.successfullyProbed, false);
  assert.deepEqual(probe.calls, [
    [executable, ["--version"]],
    ["/usr/bin/flock", ["--version"]],
  ]);
});

test("an explicit missing browser does not silently fall back to another installation", async (t) => {
  const root = await temporary(t);
  const probe = prerequisiteProbe(path.join(root, "missing browser"));
  await assert.rejects(
    checkLinuxPrerequisites(probe.options),
    /Configured browser is missing or not executable/,
  );
  assert.deepEqual(probe.calls, []);
  probe.options.env.EGO_LINUX_CHROME_PATH = "relative-browser";
  await assert.rejects(
    checkLinuxPrerequisites(probe.options),
    /absolute executable path/,
  );
});

test("failed, unidentified and older browser version probes reject support", async (t) => {
  const root = await temporary(t);
  for (const [settings, error] of [
    [{ status: 1 }, /Cannot verify/],
    [{ version: "Unrelated program 156.0" }, /Cannot verify/],
    [{ version: "Chromium 155.0.1" }, /minimum tested baseline 156/],
  ]) {
    const probe = prerequisiteProbe(await fakeBrowser(root, settings));
    await assert.rejects(checkLinuxPrerequisites(probe.options), error);
    assert.equal(
      probe.calls.length,
      1,
      "failed browser probe stops before flock",
    );
  }
});

test("newer browser versions are reported as unqualified generations", async (t) => {
  const root = await temporary(t);
  const probe = prerequisiteProbe(
    await fakeBrowser(root, { version: "Google Chrome 157.0.1" }),
  );
  const result = await checkLinuxPrerequisites(probe.options);
  assert.equal(result.browser.major, 157);
  assert.equal(result.browser.testedMajor, 156);
  assert.equal(result.browser.testedGeneration, false);
});

test("missing or unidentified util-linux flock rejects the Linux install prerequisite", async (t) => {
  const root = await temporary(t);
  const executable = await fakeBrowser(root);
  for (const flock of [
    {
      status: null,
      error: Object.assign(new Error("missing"), { code: "ENOENT" }),
    },
    { status: 1, stdout: "flock from util-linux 2.38.1" },
    { status: 0, stdout: "unrelated program 2.38.1" },
  ]) {
    const probe = prerequisiteProbe(executable, flock);
    await assert.rejects(
      checkLinuxPrerequisites(probe.options),
      /requires executable \/usr\/bin\/flock from util-linux/,
    );
  }
});

test(
  "browser prerequisite failure preserves a working Linux install before upgrade",
  {
    skip:
      process.platform !== "linux"
        ? "Linux install prerequisite integration"
        : false,
  },
  async (t) => {
    const root = await temporary(t);
    const first = await fixture(root);
    const next = await fixture(root, "0.2.0-dev.1");
    const prefix = path.join(root, "prefix");
    const env = {
      ...process.env,
      EGO_LINUX_CHROME_PATH: await fakeBrowser(root),
    };
    const installed = await install({ artifact: first.archive, prefix, env });
    assert.equal(installed.prerequisites.browser.major, 156);
    const missing = {
      ...env,
      EGO_LINUX_CHROME_PATH: path.join(root, "deleted browser"),
    };
    await assert.rejects(
      install({ artifact: next.archive, prefix, env: missing }),
      /Configured browser is missing/,
    );
    assert.equal(
      await fs.readlink(managedPaths(prefix).current),
      "0.1.0-dev.0",
    );
    assert.match(execute(prefix, "skill").stdout, /guide 0\.1\.0-dev\.0/);
    await assert.rejects(
      fs.lstat(path.join(managedPaths(prefix).root, "0.2.0-dev.1")),
      { code: "ENOENT" },
    );
    const fresh = path.join(root, "fresh prefix");
    await assert.rejects(
      install({ artifact: next.archive, prefix: fresh, env: missing }),
      /Configured browser is missing/,
    );
    await assert.rejects(fs.lstat(fresh), { code: "ENOENT" });
  },
);
