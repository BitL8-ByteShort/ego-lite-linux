import { createServer } from "node:net";
import {
  chmod,
  unlink,
  open,
  readFile,
  mkdir,
  readdir,
  writeFile,
  link,
  lstat,
} from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  resolvePaths,
  preparePaths,
  atomicJson,
  readJson,
  privateDirectory,
} from "./paths.js";
import {
  FrameDecoder,
  encodeFrame,
  REQUEST_LIMIT,
  RESPONSE_LIMIT,
} from "./transport.js";
import { launchChrome } from "./chrome-supervisor.js";
import { connectHost } from "./host-control.js";
import { LinuxHost } from "./host.js";
import { startDesktopController } from "./desktop-server.js";
export async function runHost(profileId: string) {
  const paths = resolvePaths(process.env, process.getuid?.(), profileId);
  await preparePaths(paths);
  const lock = join(paths.runtimeDir, "owner.json");
  if (process.env.EGO_LINUX_LOCK_HELD !== "1")
    throw new Error(
      "Launch the daemon through ego-browser so its kernel profile lock is held",
    );
  // util-linux flock owns a stable inode across exec; the kernel releases it on
  // exit/crash. This file is diagnostic metadata only, never process authority.
  await atomicJson(lock, { pid: process.pid, nonce: randomUUID() });
  try {
    const socket = await lstat(paths.socketPath);
    if (!socket.isSocket() || socket.uid !== process.getuid?.())
      throw new Error("Refusing to remove an unrelated host socket path");
    await unlink(paths.socketPath);
  } catch (e) {
    if ((e as any).code !== "ENOENT") throw e;
  }
  let chrome: any, host: LinuxHost, controller: any;
  let stopping = false;
  const sockets = new Set<any>();
  const server = createServer((socket) => {
    sockets.add(socket);
    const decoder = new FrameDecoder(REQUEST_LIMIT);
    const inflight = new Set<number>();
    let client: any;
    const send = (value: any) => {
      try {
        if (!socket.destroyed) socket.write(encodeFrame(value, RESPONSE_LIMIT));
      } catch {
        socket.destroy();
      }
    };
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      if (client) host.disconnect(client);
    });
    socket.on("data", (chunk) => {
      try {
        for (const request of decoder.push(chunk)) {
          if (
            request.version !== 1 ||
            !Number.isSafeInteger(request.id) ||
            inflight.has(request.id) ||
            !Array.isArray(request.args) ||
            typeof request.method !== "string"
          )
            throw new Error("Invalid RPC protocol/version/request ID");
          inflight.add(request.id);
          void (async () => {
            if (request.method === "hello") {
              if (client) throw new Error("Client already authenticated");
              const agentId = request.args[0];
              if (
                typeof agentId !== "string" ||
                !agentId.trim() ||
                agentId.length > 128
              )
                throw new Error("Agent identity required");
              client = host.add(randomUUID(), agentId, (e) => send(e));
              return {
                clientId: client.id,
                generation: chrome.generation,
                profileId,
                headless: chrome.headless,
                version: chrome.version,
              };
            }
            if (!client) throw new Error("hello required");
            if (request.method === "status")
              return {
                generation: chrome.generation,
                profileId,
                headless: chrome.headless,
                browserVersion: chrome.version,
                daemonPid: process.pid,
                browserPid: chrome.process.pid,
                tasks: host.summaries(),
              };
            if (request.method === "stop") {
              setTimeout(() => void stop(), 30);
              return {};
            }
            if (request.method === "open") {
              if (chrome.headless)
                throw new Error("Desktop launch requires headed mode");
              await chrome.bridge.call("Target.createTarget", {
                url: "about:blank",
                newWindow: true,
              });
              const controllerTarget = await chrome.bridge.call(
                "Target.createTarget",
                { url: "about:blank", newWindow: true },
              );
              host.reserveTarget(controllerTarget.targetId);
              const controllerSession = await chrome.bridge.call(
                "Target.attachToTarget",
                { targetId: controllerTarget.targetId, flatten: true },
              );
              try {
                await chrome.bridge.call(
                  "Page.navigate",
                  { url: controller.url },
                  controllerSession.sessionId,
                );
              } finally {
                await chrome.bridge.call("Target.detachFromTarget", {
                  sessionId: controllerSession.sessionId,
                });
              }
              return { opened: true };
            }
            return host.dispatch(
              client,
              request.method,
              request.args,
              request.context,
            );
          })()
            .then(
              (result) => send({ id: request.id, result }),
              (e) => {
                host.recordError(client, request.context, e);
                return send({
                  id: request.id,
                  error: {
                    message: e.message,
                    error_code:
                      e.error_code ||
                      (typeof e.code === "number"
                        ? undefined
                        : "EGO_OPERATION_FAILED"),
                    code: e.code,
                  },
                });
              },
            )
            .finally(() => inflight.delete(request.id));
        }
      } catch {
        socket.destroy();
      }
    });
  });
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await controller?.close();
    await chrome?.close();
    for (const s of sockets) s.destroy();
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await unlink(paths.socketPath).catch(() => {});
    await unlink(lock).catch(() => {});
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  try {
    chrome = await launchChrome(
      join(paths.profileDir, "chromium"),
      process.env.EGO_LINUX_HEADLESS === "1",
    );
    host = new LinuxHost(
      chrome,
      profileId,
      await readJson(join(paths.profileDir, "tasks.json"), []),
    );
    host.downloadDirectory = join(paths.profileDir, "downloads");
    await privateDirectory(host.downloadDirectory);
    const preferences = await readJson(
      join(paths.profileDir, "chromium/Default/Preferences"),
      {},
    );
    const configured = preferences.download?.default_directory;
    const normalDownloads =
      typeof configured === "string" && isAbsolute(configured)
        ? configured
        : join(process.env.HOME || paths.dataDir, "Downloads");
    await mkdir(normalDownloads, { recursive: true, mode: 0o700 });
    host.initializeDownloads(host.downloadDirectory, (active) =>
      chrome.bridge.call("Browser.setDownloadBehavior", {
        behavior: active ? "allow" : "default",
        ...(active ? { downloadPath: normalDownloads } : {}),
        eventsEnabled: true,
      }),
    );
    await chrome.bridge.call("Browser.setDownloadBehavior", {
      behavior: "default",
      eventsEnabled: true,
    });
    // Serialized atomic metadata updates cannot overwrite a later control change.
    let save = Promise.resolve();
    host.onChange = () => {
      const records = JSON.parse(
        JSON.stringify([...host.registry.tasks.values()]),
      );
      save = save.then(() =>
        atomicJson(join(paths.profileDir, "tasks.json"), records),
      );
      return save;
    };
    await host.onChange();
    controller = await startDesktopController({
      host,
      profiles: async () => {
        const root = join(paths.dataDir, "profiles");
        return (await readdir(root, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      },
      createProfile: async (id: string) => {
        const other = resolvePaths(process.env, process.getuid?.(), id);
        await preparePaths(other);
        return {
          profileId: id,
          message: `Open ego-lite --profile ${id} to use this profile.`,
        };
      },
      openProfile: async (id: string) => {
        const other = await connectHost(id, "interactive");
        try {
          return await other.connection.call("open");
        } finally {
          other.connection.close();
        }
      },
      openPersonal: () =>
        chrome.bridge.call("Target.createTarget", {
          url: "about:blank",
          newWindow: true,
        }),
      stop,
    });
    await chrome.bridge.call("Target.setDiscoverTargets", { discover: true });
    chrome.process.once("exit", () => void stop());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.socketPath, resolve);
    });
    await chmod(paths.socketPath, 0o600);
  } catch (e) {
    await stop();
    throw e;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  runHost(process.argv[2] || "default").catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
