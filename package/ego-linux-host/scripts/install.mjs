#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

export const PRODUCT = "ego-lite-linux";
export const OWNER = { schemaVersion: 1, product: PRODUCT };
export const TESTED_BROWSER_MAJOR = 156;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/;
const REQUIRED = [
  "host/bin/ego-browser.mjs",
  "host/bin/ego-lite.mjs",
  "host/dist/src/cli.js",
  "host/package.json",
  "host/scripts/install.mjs",
  "host/scripts/uninstall.mjs",
  "host/assets/ego-lite-linux.desktop",
  "sdk/index.js",
  "sdk/ego-browser/SKILL.linux.md",
  "sdk/agent-skills/ego-browser/SKILL.md",
  "LICENSE",
];

export async function exists(filename) {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function safeRelative(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\\\x00-\x1f\x7f]/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

export async function payloadFiles(root, directory = "") {
  const files = [];
  for (const name of (await fs.readdir(path.join(root, directory))).sort()) {
    const relative = directory ? `${directory}/${name}` : name;
    if (!safeRelative(relative))
      throw new Error(`Unsafe payload path: ${relative}`);
    const info = await fs.lstat(path.join(root, relative));
    if (info.isSymbolicLink())
      throw new Error(`Payload symlinks are not allowed: ${relative}`);
    if (info.isDirectory()) files.push(...(await payloadFiles(root, relative)));
    else if (info.isFile()) files.push(relative);
    else throw new Error(`Unsupported payload file: ${relative}`);
  }
  return files;
}

export async function sha256(filename) {
  return createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
}

export async function writeManifest(root, metadata) {
  const files = {};
  for (const relative of await payloadFiles(root)) {
    if (relative === "manifest.json") continue;
    files[relative] = {
      sha256: await sha256(path.join(root, relative)),
      mode: (await fs.stat(path.join(root, relative))).mode & 0o777,
    };
  }
  const manifest = { schemaVersion: 1, product: PRODUCT, ...metadata, files };
  await fs.writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function verifyPayload(root) {
  const rootInfo = await fs.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Payload root must be a real directory");
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== PRODUCT ||
    !VERSION.test(manifest.version) ||
    manifest.platform !== "linux" ||
    !["x64", "arm64"].includes(manifest.arch) ||
    !manifest.files ||
    Array.isArray(manifest.files)
  )
    throw new Error("Invalid ego-lite-linux artifact manifest");
  const actual = (await payloadFiles(root)).filter(
    (name) => name !== "manifest.json",
  );
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) {
    throw new Error("Artifact file inventory does not match its manifest");
  }
  for (const relative of REQUIRED) {
    if (!expected.includes(relative))
      throw new Error(`Artifact is missing ${relative}`);
  }
  for (const relative of expected) {
    const entry = manifest.files[relative];
    if (!safeRelative(relative) || !/^[a-f0-9]{64}$/.test(entry?.sha256)) {
      throw new Error(`Invalid manifest entry: ${relative}`);
    }
    if ((await sha256(path.join(root, relative))) !== entry.sha256) {
      throw new Error(`Artifact checksum mismatch: ${relative}`);
    }
    const fullMode = (await fs.stat(path.join(root, relative))).mode;
    const mode = fullMode & 0o777;
    if (entry.mode !== mode || mode & 0o022 || fullMode & 0o7000) {
      throw new Error(`Unsafe or mismatched artifact mode: ${relative}`);
    }
  }
  const hostPackage = JSON.parse(
    await fs.readFile(path.join(root, "host/package.json"), "utf8"),
  );
  if (
    hostPackage.version !== manifest.version ||
    hostPackage.type !== "module"
  ) {
    throw new Error("Host package and artifact versions do not match");
  }
  return manifest;
}

function parsePax(bytes) {
  const values = {};
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset);
    const length = Number(bytes.subarray(offset, space).toString());
    if (
      space < offset ||
      !Number.isSafeInteger(length) ||
      length < 4 ||
      offset + length > bytes.length
    ) {
      throw new Error("Invalid archive extended header");
    }
    const record = bytes.subarray(space + 1, offset + length - 1).toString();
    const equal = record.indexOf("=");
    if (equal < 1) throw new Error("Invalid archive extended attribute");
    values[record.slice(0, equal)] = record.slice(equal + 1);
    offset += length;
  }
  return values;
}

// Extract regular files ourselves: tar links, devices and traversal never reach the filesystem.
export async function extractArchive(archive, destination) {
  if ((await fs.stat(archive)).size > MAX_ARCHIVE_BYTES)
    throw new Error("Archive is too large");
  const compressed = await fs.readFile(archive);
  if (compressed.length > MAX_ARCHIVE_BYTES)
    throw new Error("Archive is too large");
  const bytes = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const string = (block, start, length) =>
    block
      .subarray(start, start + length)
      .toString()
      .replace(/\0.*$/s, "");
  let pax = {};
  let longName;
  const names = new Set();
  const roots = new Set();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const sizeText = string(header, 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("Invalid archive size");
    const size = Number.parseInt(sizeText, 8);
    const sum = Number.parseInt(string(header, 148, 8).trim(), 8);
    const checksum = header.reduce(
      (total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== sum || offset + 512 + size > bytes.length)
      throw new Error("Corrupt tar archive");
    const content = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = string(header, 156, 1);
    if (type === "x" || type === "g") {
      const attributes = parsePax(content);
      if (type === "g" && (attributes.path || attributes.linkpath))
        throw new Error("Unsafe global archive path");
      if (type === "x") pax = attributes;
      continue;
    }
    if (type === "L") {
      longName = content.toString().replace(/\0.*$/s, "").replace(/\n$/, "");
      continue;
    }
    if (type !== "" && type !== "0" && type !== "5")
      throw new Error("Archive contains unsupported links or special files");
    const prefix = string(header, 345, 155);
    const name = (
      pax.path ||
      longName ||
      `${prefix ? `${prefix}/` : ""}${string(header, 0, 100)}`
    ).replace(/\/$/, "");
    pax = {};
    longName = undefined;
    if (!safeRelative(name) || names.has(name))
      throw new Error(`Unsafe or duplicate archive path: ${name}`);
    names.add(name);
    roots.add(name.split("/")[0]);
    const filename = path.join(destination, name);
    if (type === "5")
      await fs.mkdir(filename, { recursive: true, mode: 0o700 });
    else {
      const modeText = string(header, 100, 8).trim();
      if (!/^[0-7]+$/.test(modeText)) throw new Error("Invalid archive mode");
      const mode = Number.parseInt(modeText, 8);
      if (mode & 0o7022)
        throw new Error("Unsafe writable or privileged archive file");
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await fs.writeFile(filename, content, { flag: "wx", mode: mode & 0o777 });
      await fs.chmod(filename, mode & 0o777);
    }
  }
  if (roots.size !== 1)
    throw new Error("Archive must contain one payload directory");
  return path.join(destination, [...roots][0]);
}

export function managedPaths(prefix) {
  const root = path.join(prefix, "lib", PRODUCT);
  return {
    root,
    current: path.join(root, "current"),
    owner: path.join(root, ".owner.json"),
    desktop: path.join(prefix, "share", "applications", `${PRODUCT}.desktop`),
    launchers: ["ego-browser", "ego-lite"].map((name) => ({
      filename: path.join(prefix, "bin", name),
      target: `../lib/${PRODUCT}/current/host/bin/${name}.mjs`,
    })),
  };
}

export function desktopContent(prefix) {
  const executable = path
    .join(prefix, "bin", "ego-lite")
    .replace(/%/g, "%%")
    .replace(/[\\"`$]/g, "\\$&")
    .replace(/\\/g, "\\\\");
  return `[Desktop Entry]\nType=Application\nName=ego lite (Community Linux)\nComment=Persistent browser profiles and agent task spaces\nExec="${executable}"\nTerminal=false\nCategories=Network;WebBrowser;\nStartupNotify=true\nX-Ego-Lite-Linux-Managed=true\n`;
}

export async function assertOwnedRoot(paths) {
  const info = await exists(paths.root);
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Refusing unrelated installation path: ${paths.root}`);
  try {
    if (
      JSON.stringify(JSON.parse(await fs.readFile(paths.owner, "utf8"))) !==
      JSON.stringify(OWNER)
    )
      throw new Error();
  } catch {
    throw new Error(
      `Refusing installation without an ownership marker: ${paths.root}`,
    );
  }
  return true;
}

export async function ownedLink(filename, target) {
  const info = await exists(filename);
  return info?.isSymbolicLink() && (await fs.readlink(filename)) === target;
}

async function linkState(filename) {
  const info = await exists(filename);
  return info ? { type: "link", value: await fs.readlink(filename) } : null;
}

async function replaceLink(filename, target) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.symlink(target, temporary);
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function checkNode(env = process.env) {
  const result = spawnSync("node", ["--version"], { encoding: "utf8", env });
  const major = /^v(\d+)\./.exec(result.stdout?.trim() || "");
  if (result.status !== 0 || !major || Number(major[1]) < 22) {
    throw new Error("Node.js 22 or later must be available as node on PATH");
  }
  return result.stdout.trim();
}

// The injectable runner is for portable contract tests; the installer always
// probes the actual platform and executables, with no skip option or CLI flag.
export async function checkLinuxPrerequisites({
  platform = process.platform,
  env = process.env,
  run = spawnSync,
} = {}) {
  if (platform !== "linux")
    return {
      platform,
      checked: false,
      reason: "Linux prerequisites require Linux",
    };
  const configured = env.EGO_LINUX_CHROME_PATH;
  if (configured && !path.isAbsolute(configured))
    throw new Error(
      "EGO_LINUX_CHROME_PATH must be an absolute executable path",
    );
  const candidates = configured
    ? [configured]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
  let executable;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, 1);
      executable = candidate;
      break;
    } catch {}
  }
  if (!executable)
    throw new Error(
      configured
        ? `Configured browser is missing or not executable: ${configured}`
        : "No Chrome/Chromium executable. Install Chrome/Chromium or set EGO_LINUX_CHROME_PATH to an absolute executable path.",
    );
  const options = { encoding: "utf8", env, timeout: 10000, maxBuffer: 65536 };
  const browser = run(executable, ["--version"], options);
  const browserVersion =
    `${browser.stdout || ""}\n${browser.stderr || ""}`.trim();
  const majorMatch =
    /^(?:Chromium|Google Chrome(?: for Testing)?|Chrome)\s+(\d+)\./m.exec(
      browserVersion,
    );
  if (browser.status !== 0 || !majorMatch)
    throw new Error(
      `Cannot verify Chrome/Chromium version at ${executable}: --version must succeed and identify Chrome/Chromium`,
    );
  const major = Number(majorMatch[1]);
  if (major < TESTED_BROWSER_MAJOR)
    throw new Error(
      `Chrome/Chromium ${major} is below this build's minimum tested baseline ${TESTED_BROWSER_MAJOR}; install Chromium/Chrome ${TESTED_BROWSER_MAJOR} or later. Newer generations still require live qualification.`,
    );
  const flockExecutable = "/usr/bin/flock";
  const flock = run(flockExecutable, ["--version"], options);
  const flockVersion = `${flock.stdout || ""}\n${flock.stderr || ""}`.trim();
  if (flock.status !== 0 || !/^flock from util-linux\s+\d+/m.test(flockVersion))
    throw new Error(
      "The Linux host requires executable /usr/bin/flock from util-linux; install the util-linux package (--version probe failed)",
    );
  return {
    platform,
    checked: true,
    browser: {
      executable,
      version: browserVersion,
      major,
      testedMajor: TESTED_BROWSER_MAJOR,
      testedGeneration: major === TESTED_BROWSER_MAJOR,
    },
    flock: { executable: flockExecutable, version: flockVersion },
    sandbox: {
      successfullyProbed: false,
      note: "Version checks do not probe Chromium sandbox startup; run the installed doctor and real browser qualification.",
    },
  };
}

export async function install({
  artifact,
  prefix = path.join(os.homedir(), ".local"),
  desktop = true,
  afterCommit,
  env = process.env,
} = {}) {
  const nodeVersion = checkNode(env);
  const prerequisites = await checkLinuxPrerequisites({ env });
  prefix = path.resolve(prefix);
  if (/[\x00-\x1f\x7f]/.test(prefix))
    throw new Error("Installation prefix contains control characters");
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "ego-linux-install-"),
  );
  const paths = managedPaths(prefix);
  let locked = false;
  let rootExisted = false;
  let rootCreated = false;
  let staged;
  let versionCreated = false;
  let committed = false;
  let oldCurrent;
  let oldDesktop;
  const oldLaunchers = [];
  let versionPath;
  try {
    artifact = path.resolve(
      artifact ||
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    );
    const artifactInfo = await fs.stat(artifact);
    const source = artifactInfo.isDirectory()
      ? await fs.realpath(artifact)
      : await extractArchive(artifact, scratch);
    const manifest = await verifyPayload(source);
    if (process.platform === "linux" && manifest.arch !== process.arch)
      throw new Error(
        `Artifact is for ${manifest.arch}; this machine is ${process.arch}`,
      );
    await fs.mkdir(path.dirname(paths.root), { recursive: true });
    await fs.mkdir(`${paths.root}.install-lock`, { mode: 0o700 });
    locked = true;
    rootExisted = await assertOwnedRoot(paths);
    for (const launcher of paths.launchers) {
      if (
        (await exists(launcher.filename)) &&
        !(await ownedLink(launcher.filename, launcher.target))
      ) {
        throw new Error(
          `Refusing to overwrite unrelated command: ${launcher.filename}`,
        );
      }
      oldLaunchers.push(await linkState(launcher.filename));
    }
    oldCurrent = await linkState(paths.current).catch(() => {
      throw new Error("Refusing unrelated current installation path");
    });
    if (
      oldCurrent &&
      (!VERSION.test(oldCurrent.value) ||
        !(await exists(path.join(paths.root, oldCurrent.value))))
    ) {
      throw new Error("Refusing unrelated current installation link");
    }
    const desktopInfo = await exists(paths.desktop);
    if (desktopInfo) {
      if (!desktopInfo.isFile() || desktopInfo.isSymbolicLink())
        throw new Error(`Refusing unrelated desktop entry: ${paths.desktop}`);
      oldDesktop = await fs.readFile(paths.desktop, "utf8");
      if (oldDesktop !== desktopContent(prefix))
        throw new Error(
          `Refusing to overwrite unrelated desktop entry: ${paths.desktop}`,
        );
    }
    await fs.mkdir(paths.root, { recursive: true });
    if (!rootExisted) {
      rootCreated = true;
      await fs.writeFile(paths.owner, `${JSON.stringify(OWNER)}\n`, {
        flag: "wx",
        mode: 0o644,
      });
    }
    versionPath = path.join(paths.root, manifest.version);
    if (await exists(versionPath)) {
      const installed = await verifyPayload(versionPath);
      if (JSON.stringify(installed) !== JSON.stringify(manifest))
        throw new Error(
          `Version ${manifest.version} is already installed with different contents`,
        );
    } else {
      staged = path.join(paths.root, `.stage-${randomUUID()}`);
      await fs.cp(source, staged, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
      await verifyPayload(staged);
      await fs.rename(staged, versionPath);
      staged = undefined;
      versionCreated = true;
    }
    committed = true;
    await replaceLink(paths.current, manifest.version);
    for (const launcher of paths.launchers)
      await replaceLink(launcher.filename, launcher.target);
    if (desktop) {
      await fs.mkdir(path.dirname(paths.desktop), { recursive: true });
      const temporary = `${paths.desktop}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, desktopContent(prefix), {
          mode: 0o644,
          flag: "wx",
        });
        await fs.rename(temporary, paths.desktop);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    if (afterCommit) await afterCommit();
    return {
      version: manifest.version,
      prefix,
      executable: path.join(prefix, "bin", "ego-browser"),
      payload: versionPath,
      prerequisites: { node: nodeVersion, ...prerequisites },
    };
  } catch (error) {
    if (committed) {
      for (let i = 0; i < paths.launchers.length; i++) {
        if (oldLaunchers[i])
          await replaceLink(paths.launchers[i].filename, oldLaunchers[i].value);
        else await fs.rm(paths.launchers[i].filename, { force: true });
      }
      if (oldCurrent) await replaceLink(paths.current, oldCurrent.value);
      else await fs.rm(paths.current, { force: true });
      if (oldDesktop !== undefined)
        await fs.writeFile(paths.desktop, oldDesktop, { mode: 0o644 });
      else if (desktop) await fs.rm(paths.desktop, { force: true });
    }
    if (versionCreated)
      await fs.rm(versionPath, { recursive: true, force: true });
    if (rootCreated) await fs.rm(paths.root, { recursive: true, force: true });
    throw error;
  } finally {
    if (staged) await fs.rm(staged, { recursive: true, force: true });
    if (locked) await fs.rmdir(`${paths.root}.install-lock`);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node install.mjs [--artifact DIR|ARCHIVE.tar.gz] [--prefix DIR] [--no-desktop]\nRequires Node.js >=22 on PATH; Linux requires Chrome/Chromium >=156 and /usr/bin/flock from util-linux. Profiles are retained.",
      );
      return;
    }
    if (argument === "--no-desktop") options.desktop = false;
    else if (["--artifact", "--prefix"].includes(argument) && argv[i + 1])
      options[argument.slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  const result = await install(options);
  const quoted = (value) => `'${value.replace(/'/g, "'\\''")}'`;
  console.log(
    `Installed ego lite community Linux ${result.version} in ${result.prefix}\nRequires sandbox-capable Chrome/Chromium. Check: ${quoted(result.executable)} doctor --json\nAdd ${quoted(path.join(result.prefix, "bin"))} to PATH. Profile data was preserved.`,
  );
  console.log(`Prerequisite versions: ${JSON.stringify(result.prerequisites)}`);
  if (process.platform === "linux") {
    const doctor = spawnSync(result.executable, ["doctor", "--json"], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    });
    if (doctor.status === 0)
      console.log(
        `Installed doctor (configuration check): ${doctor.stdout.trim()}`,
      );
    else
      console.error(
        `Installed doctor failed; run ${quoted(result.executable)} doctor --json for details. Installation files are in ${result.prefix}.`,
      );
  }
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
