import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { privateDirectory } from "./paths.js";
import { CdpBridge } from "./cdp-bridge.js";
export function chromeArguments(profileDir: string, headless: boolean) {
  return [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-session-crashed-bubble",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ];
}
export async function findChrome() {
  const candidates = process.env.EGO_LINUX_CHROME_PATH
    ? [process.env.EGO_LINUX_CHROME_PATH]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
  for (const p of candidates) {
    try {
      await access(p, 1);
      return p;
    } catch {}
  }
  throw new Error(
    "No Chrome/Chromium executable. Install a sandbox-capable browser or set EGO_LINUX_CHROME_PATH.",
  );
}
export type ChromeInstance = {
  generation: string;
  process: ChildProcess;
  bridge: CdpBridge;
  headless: boolean;
  executable: string;
  version: any;
  close: () => Promise<void>;
};
export async function launchChrome(
  profileDir: string,
  headless: boolean,
): Promise<ChromeInstance> {
  if (process.platform !== "linux")
    throw new Error("The Linux host must run on Linux");
  if (process.getuid?.() === 0)
    throw new Error(
      "Run ego lite as an unprivileged user; Chromium sandbox is required",
    );
  if (!headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    throw new Error(
      "No desktop display. Set EGO_LINUX_HEADLESS=1 for explicit headless mode.",
    );
  await privateDirectory(profileDir);
  const executable = await findChrome();
  const child = spawn(executable, chromeArguments(profileDir, headless), {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr?.on("data", (b) => {
    diagnostics = (diagnostics + b.toString()).slice(-4096);
  });
  const bridge = new CdpBridge(
    child.stdio[3] as Writable,
    child.stdio[4] as Readable,
    15000,
  );
  child.once("error", (e) => bridge.close(e));
  child.once("exit", () =>
    bridge.close(
      new Error(
        `Chromium exited. Sandbox startup failed or browser closed. ${diagnostics.replace(/https?:\/\/\S+/g, "[URL]")}`,
      ),
    ),
  );
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await bridge.call("Browser.close", {}, undefined, 2000).catch(() => {});
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
          new Promise<void>((r) => child.once("exit", () => r())),
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]);
      }
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      bridge.close();
      child.stderr?.destroy();
    })());
  try {
    const version = await bridge.call("Browser.getVersion");
    return {
      generation: randomUUID(),
      process: child,
      bridge,
      headless,
      executable,
      version,
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
export async function doctor() {
  let executable: string | undefined;
  let version = "";
  let error: string | undefined;
  try {
    executable = await findChrome();
    const r = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0) throw new Error("Browser --version failed");
    version = r.stdout.trim();
  } catch (e) {
    error = (e as Error).message;
  }
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    executable,
    version,
    kernelLock: {
      executable: "/usr/bin/flock",
      available:
        spawnSync("/usr/bin/flock", ["--version"], {
          encoding: "utf8",
          timeout: 3000,
        }).status === 0,
    },
    error,
    display: process.env.WAYLAND_DISPLAY
      ? "wayland-configured"
      : process.env.DISPLAY
        ? "x11-configured"
        : "none",
    sandbox: {
      configured: true,
      successfullyProbed: false,
      note: "No --no-sandbox; run test:browser to probe actual sandboxed startup.",
    },
    agentIdentity: process.env.EGO_LINUX_AGENT_ID
      ? "environment"
      : "interactive default",
  };
}
