#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertOwnedRoot,
  desktopContent,
  exists,
  managedPaths,
  ownedLink,
  verifyPayload,
} from "./install.mjs";

export async function uninstall({
  prefix = path.join(os.homedir(), ".local"),
} = {}) {
  prefix = path.resolve(prefix);
  const paths = managedPaths(prefix);
  if (!(await exists(paths.root))) return { prefix, removed: [], retained: [] };
  await fs.mkdir(`${paths.root}.install-lock`, { mode: 0o700 });
  const removed = [];
  const retained = [];
  try {
    await assertOwnedRoot(paths);
    const versions = [];
    for (const name of await fs.readdir(paths.root)) {
      if (name === "current" || name === ".owner.json") continue;
      const filename = path.join(paths.root, name);
      try {
        const manifest = await verifyPayload(filename);
        if (name !== manifest.version)
          throw new Error("Version directory mismatch");
        versions.push(filename);
      } catch {
        retained.push(filename);
      }
    }
    for (const launcher of paths.launchers) {
      if (await ownedLink(launcher.filename, launcher.target)) {
        await fs.unlink(launcher.filename);
        removed.push(launcher.filename);
      } else if (await exists(launcher.filename))
        retained.push(launcher.filename);
    }
    const desktopInfo = await exists(paths.desktop);
    if (
      desktopInfo?.isFile() &&
      !desktopInfo.isSymbolicLink() &&
      (await fs.readFile(paths.desktop, "utf8")) === desktopContent(prefix)
    ) {
      await fs.unlink(paths.desktop);
      removed.push(paths.desktop);
    } else if (desktopInfo) retained.push(paths.desktop);
    const currentInfo = await exists(paths.current);
    if (
      currentInfo?.isSymbolicLink() &&
      versions.includes(path.join(paths.root, await fs.readlink(paths.current)))
    )
      await fs.unlink(paths.current);
    else if (currentInfo) retained.push(paths.current);
    for (const filename of versions) {
      await fs.rm(filename, { recursive: true });
      removed.push(filename);
    }
    if (
      (await fs.readdir(paths.root)).every((name) => name === ".owner.json")
    ) {
      await fs.unlink(paths.owner);
      await fs.rmdir(paths.root);
    }
    return { prefix, removed, retained };
  } finally {
    await fs.rmdir(`${paths.root}.install-lock`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let prefix;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node uninstall.mjs [--prefix DIR]\nRemoves owned binaries and desktop integration. Always retains profile and sign-in data.",
      );
      return;
    }
    if (argv[i] === "--prefix" && argv[i + 1]) prefix = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  const result = await uninstall({ prefix });
  console.log(
    `Removed ${result.removed.length} owned installation paths. Profile and sign-in data were retained.`,
  );
  if (result.retained.length)
    console.log(
      `Retained modified or unrelated paths:\n${result.retained.join("\n")}`,
    );
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
