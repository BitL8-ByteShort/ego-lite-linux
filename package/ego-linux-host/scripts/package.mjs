#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  payloadFiles,
  sha256,
  verifyPayload,
  writeManifest,
} from "./install.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status ?? result.error?.message})`,
    );
}

async function copy(source, destination) {
  await payloadFiles(source);
  await fs.cp(source, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
}

export async function packageArtifact({
  hostDir = path.resolve(here, ".."),
  sdkDir = path.join(repository, "package/ego-browser/dist/out"),
  outputDir = path.join(repository, "artifacts/linux"),
  license = path.join(repository, "LICENSE"),
  attribution = path.join(repository, "docs/linux/ATTRIBUTION.md"),
  arch = process.arch,
  build = false,
} = {}) {
  if (!["x64", "arm64"].includes(arch))
    throw new Error(`Unsupported artifact architecture: ${arch}`);
  if (build) {
    run("npm", ["run", "build"], path.join(repository, "package/ego-browser"));
    run("npm", ["run", "build"], hostDir);
  }
  const hostPackage = JSON.parse(
    await fs.readFile(path.join(hostDir, "package.json"), "utf8"),
  );
  const name = `ego-lite-linux-${hostPackage.version}-linux-${arch}`;
  if (
    !/^ego-lite-linux-[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?-linux-(x64|arm64)$/.test(
      name,
    )
  )
    throw new Error("Invalid artifact version");
  const staging = await fs.mkdtemp(
    path.join(os.tmpdir(), "ego-linux-package-"),
  );
  try {
    const root = path.join(staging, name);
    await fs.mkdir(path.join(root, "host"), { recursive: true });
    for (const directory of ["bin", "dist/src", "assets"])
      await copy(
        path.join(hostDir, directory),
        path.join(root, "host", directory),
      );
    // Runtime modules may include desktop static files copied by the host build.
    await fs.copyFile(
      path.join(hostDir, "package.json"),
      path.join(root, "host/package.json"),
    );
    await fs.mkdir(path.join(root, "host/scripts"));
    for (const script of ["install.mjs", "uninstall.mjs"])
      await fs.copyFile(
        path.join(here, script),
        path.join(root, "host/scripts", script),
      );
    await copy(sdkDir, path.join(root, "sdk"));
    await fs.copyFile(license, path.join(root, "LICENSE"));
    try {
      await fs.copyFile(attribution, path.join(root, "ATTRIBUTION.md"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(
      path.join(root, "README.txt"),
      "ego lite community Linux build\nRequires Node.js >=22 on PATH, separately installed sandbox-capable Chrome/Chromium >=156, and /usr/bin/flock from util-linux.\nChromium 156 is the tested baseline; newer browser generations require live qualification.\nInstall: node host/scripts/install.mjs\nData and sign-ins are retained on upgrade and uninstall.\n",
    );
    for (const relative of await payloadFiles(root)) {
      const executable = relative.startsWith("host/bin/");
      await fs.chmod(path.join(root, relative), executable ? 0o755 : 0o644);
    }
    let gitCommit = null;
    const git = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    });
    if (git.status === 0) gitCommit = git.stdout.trim();
    const manifest = await writeManifest(root, {
      version: hostPackage.version,
      platform: "linux",
      arch,
      node: ">=22",
      browser:
        "separately installed sandbox-capable Chrome/Chromium >=156 (tested baseline: 156)",
      startupLock: "/usr/bin/flock from util-linux",
      gitCommit,
    });
    await verifyPayload(root);
    await fs.mkdir(outputDir, { recursive: true });
    const archive = path.join(outputDir, `${name}.tar.gz`);
    const temporary = `${archive}.${process.pid}.tmp`;
    try {
      run("tar", ["-czf", temporary, "-C", staging, name], repository);
      await fs.rename(temporary, archive);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    const checksum = await sha256(archive);
    await fs.writeFile(
      `${archive}.sha256`,
      `${checksum}  ${path.basename(archive)}\n`,
    );
    await fs.writeFile(
      path.join(outputDir, `${name}.manifest.json`),
      `${JSON.stringify({ ...manifest, archive: path.basename(archive), archiveSha256: checksum }, null, 2)}\n`,
    );
    return { archive, checksum, manifest };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--build") options.build = true;
    else if (argv[i] === "--output-dir" && argv[i + 1])
      options.outputDir = path.resolve(argv[++i]);
    else if (argv[i] === "--arch" && argv[i + 1]) options.arch = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node scripts/package.mjs [--build] [--output-dir DIR] [--arch x64|arm64]\nUses existing host + SDK build outputs unless --build is supplied.",
      );
      return;
    } else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  const result = await packageArtifact(options);
  console.log(`${result.archive}\nSHA-256 ${result.checksum}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
