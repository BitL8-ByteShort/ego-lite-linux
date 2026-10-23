import { spawn } from "node:child_process";
import { readFile, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { resolvePaths, preparePaths } from "./paths.js";
import { HostConnection } from "./transport.js";
export async function connectHost(
  profileId: string,
  agentId: string,
  start = true,
) {
  const paths = resolvePaths(process.env, process.getuid?.(), profileId);
  await preparePaths(paths);
  const attempt = async () => {
    const stat = await lstat(paths.socketPath);
    if (
      !stat.isSocket() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o077
    )
      throw new Error("Host socket must be private and owned");
    const connection = await new HostConnection(paths.socketPath).ready();
    try {
      const hello = await connection.call("hello", [agentId], undefined, 20000);
      return { connection, hello, paths };
    } catch (e) {
      connection.close();
      throw e;
    }
  };
  try {
    return await attempt();
  } catch (e) {
    if (!start) throw e;
  }
  if (process.platform !== "linux")
    throw new Error("The Linux browser host can only launch on Linux");
  const kernelLock = join(paths.runtimeDir, "daemon.lock");
  const fd = await open(kernelLock, "a", 0o600);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
      throw new Error("Kernel lock must be a private owned file");
  } finally {
    await fd.close();
  }
  let error = "";
  let launchError: Error | undefined;
  const launch = () => {
    const child = spawn(
      "/usr/bin/flock",
      [
        "--nonblock",
        "--no-fork",
        "--conflict-exit-code",
        "73",
        kernelLock,
        process.execPath,
        fileURLToPath(new URL("./host-daemon.js", import.meta.url)),
        profileId,
      ],
      {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, EGO_LINUX_LOCK_HELD: "1" },
      },
    );
    child.once("error", (e) => {
      launchError = e;
    });
    child.stderr?.on("data", (b) => {
      error = (error + b.toString()).slice(-4096);
    });
    (child.stderr as any)?.unref?.();
    child.unref();
    return child;
  };
  let child = launch();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      return await attempt();
    } catch {}
    if (launchError)
      throw new Error(
        `Cannot start Linux host; install util-linux flock: ${launchError.message}`,
      );
    if (child.exitCode === 73) {
      await delay(150);
      child = launch();
      continue;
    }
    if (child.exitCode !== null && error && !/already running/.test(error))
      throw new Error(error.trim());
    await delay(75);
  }
  throw new Error(`Linux host startup timed out. ${error}`);
}
