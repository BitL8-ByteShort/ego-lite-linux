import { readFile, access, lstat } from "node:fs/promises";
import { resolve, join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectHost } from "./host-control.js";
import { createEgoAdapter } from "./ego-client.js";
import { doctor } from "./chrome-supervisor.js";
import { privateDirectory } from "./paths.js";
import { setTimeout as delay } from "node:timers/promises";
const usage =
  "Usage: ego-browser [skill|nodejs [-e CODE|FILE] [--sdk-path PATH]|doctor [--json]|status|stop|open] [--profile ID] [--agent-id ID]";
export function parseArguments(argv: string[]) {
  const out: any = {
    command: "nodejs",
    profile: process.env.EGO_LINUX_PROFILE || "default",
    agentId: process.env.EGO_LINUX_AGENT_ID || "interactive",
  };
  const args = [...argv];
  for (let i = 0; i < args.length;) {
    const key = args[i];
    if (["--sdk-path", "--profile", "--agent-id"].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(usage);
      out[
        {
          "--sdk-path": "sdkPath",
          "--profile": "profile",
          "--agent-id": "agentId",
        }[key]!
      ] = args[i + 1];
      args.splice(i, 2);
    } else i++;
  }
  if (["--help", "-h"].includes(args[0])) {
    if (args.length !== 1) throw new Error(usage);
    return { ...out, command: "help" };
  }
  if (args[0]) {
    if (
      !["nodejs", "skill", "doctor", "status", "stop", "open"].includes(args[0])
    )
      throw new Error(usage);
    out.command = args.shift();
  }
  if (out.command === "nodejs") {
    if (args[0] === "-e" && args.length === 2) out.code = args[1];
    else if (args.length === 1 && !args[0].startsWith("-")) out.file = args[0];
    else if (args.length) throw new Error(usage);
  } else if (
    out.command === "doctor" &&
    args[0] === "--json" &&
    args.length === 1
  )
    out.json = true;
  else if (args.length) throw new Error(usage);
  return out;
}
export async function resolveSdkPayload(override?: string) {
  const hostRoot = fileURLToPath(new URL("../..", import.meta.url));
  const bundle = override
    ? resolve(override)
    : resolve(hostRoot, "../ego-browser/dist/out/index.js");
  let chosen = bundle;
  if (!override) {
    const packaged = resolve(hostRoot, "../sdk/index.js");
    try {
      await access(packaged);
      chosen = packaged;
    } catch {}
  }
  if (override && !isAbsolute(override))
    throw new Error("SDK path must be absolute");
  const guideDir = join(dirname(chosen), "ego-browser");
  try {
    await access(chosen);
    await access(join(guideDir, "SKILL.linux.md"));
    await access(join(dirname(chosen), "agent-skills/ego-browser/SKILL.md"));
  } catch {
    throw new Error(
      `SDK payload missing bundle, Linux guide or entry skill: ${chosen}. Build package/ego-browser or reinstall the complete payload.`,
    );
  }
  return {
    bundle: chosen,
    guideDir,
    entrySkillDir: join(dirname(chosen), "agent-skills/ego-browser"),
  };
}
export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  let connected: any, sdk: any;
  try {
    const options = parseArguments(argv);
    if (options.command === "help") {
      console.log(usage);
      return 0;
    }
    if (options.command === "doctor") {
      console.log(JSON.stringify(await doctor(), null, options.json ? 0 : 2));
      return 0;
    }
    if (["status", "stop", "open"].includes(options.command)) {
      connected = await connectHost(
        options.profile,
        options.agentId,
        options.command === "open",
      );
      const result = await connected.connection.call(options.command);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      if (options.command === "stop") {
        connected.connection.close();
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          try {
            await lstat(connected.paths.socketPath);
          } catch (e) {
            if ((e as any).code === "ENOENT") return 0;
            throw e;
          }
          await delay(50);
        }
        throw new Error("Host did not finish stopping");
      }
      return 0;
    }
    const payload = await resolveSdkPayload(options.sdkPath);
    if (options.command === "skill") {
      process.stdout.write(
        await readFile(join(payload.guideDir, "SKILL.linux.md"), "utf8"),
      );
      return 0;
    }
    const code =
      options.code ??
      (options.file
        ? await readFile(resolve(options.file), "utf8")
        : await new Promise<string>((r, j) => {
            let s = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (b) => (s += b));
            process.stdin.on("end", () => r(s));
            process.stdin.on("error", j);
          }));
    if (!code.trim()) throw new Error(usage);
    if (!(globalThis as any).ego) {
      connected = await connectHost(options.profile, options.agentId);
      const { hello, paths, connection } = connected;
      const stateDir = join(
        paths.dataDir,
        "sdk-state",
        options.profile,
        hello.generation,
      );
      await privateDirectory(stateDir);
      process.env.EGO_BROWSER_STATE_DIR = stateDir;
      process.env.EGO_BROWSER_RUNTIME_INSTANCE_ID = `linux:${options.profile}:${hello.generation}`;
      process.env.EGO_BROWSER_AGENT_WORKSPACE =
        process.env.EGO_BROWSER_AGENT_WORKSPACE || payload.entrySkillDir;
      (globalThis as any).ego = createEgoAdapter(connection, hello);
    }
    sdk = await import(pathToFileURL(payload.bundle).href);
    return await sdk.runMain({ argv: [], stdinText: code });
  } catch (e) {
    process.stderr.write(((e as Error).message || String(e)) + "\n");
    return 1;
  } finally {
    await sdk?.disposeEgoSdk?.();
    connected?.connection.close();
  }
}
