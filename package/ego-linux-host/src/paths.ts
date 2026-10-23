import { lstat, mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
export function profileId(id = "default") {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(id))
    throw new Error(
      "Profile ID must be 1–48 letters, digits, underscores or hyphens",
    );
  return id;
}
export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
  uid = process.getuid?.() ?? 0,
  id = "default",
) {
  profileId(id);
  const home = env.HOME || homedir();
  const base = env.XDG_DATA_HOME || join(home, ".local/share");
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  if (![base, config].every(isAbsolute))
    throw new Error("XDG paths must be absolute");
  const key = createHash("sha256")
    .update(`${base}\0${id}`)
    .digest("hex")
    .slice(0, 12);
  const runtimeRoot = env.XDG_RUNTIME_DIR || join(tmpdir(), `ego-${uid}`);
  if (!isAbsolute(runtimeRoot))
    throw new Error("Runtime path must be absolute");
  const runtimeDir = join(runtimeRoot, `ego-lite-${key}`);
  const socketPath = join(runtimeDir, "host.sock");
  if (Buffer.byteLength(socketPath) >= 104)
    throw new Error(
      "Unix socket path too long; use a short private XDG_RUNTIME_DIR",
    );
  return {
    configDir: join(config, "ego-lite-linux"),
    dataDir: join(base, "ego-lite-linux"),
    runtimeRoot,
    runtimeDir,
    socketPath,
    profileDir: join(base, "ego-lite-linux/profiles", id),
    profileId: id,
  };
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (process.getuid && s.uid !== process.getuid()) ||
    s.mode & 0o077
  )
    throw new Error(`Directory must be private, owned and mode 0700: ${path}`);
}
export async function preparePaths(paths: ReturnType<typeof resolvePaths>) {
  for (const dir of [
    paths.configDir,
    paths.dataDir,
    paths.runtimeRoot,
    paths.runtimeDir,
    join(paths.dataDir, "profiles"),
    paths.profileDir,
  ])
    await privateDirectory(dir);
}
export async function atomicJson(path: string, value: any) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
export async function readJson(path: string, fallback: any) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as any).code === "ENOENT") return fallback;
    throw e;
  }
}
