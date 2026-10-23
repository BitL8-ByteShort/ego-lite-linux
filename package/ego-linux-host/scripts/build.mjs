import { build } from "esbuild";
import { readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(resolve(root, "dist/src"), { recursive: true });
await build({
  entryPoints: (await readdir(resolve(root, "src")))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => resolve(root, "src", f)),
  outdir: resolve(root, "dist/src"),
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
});
