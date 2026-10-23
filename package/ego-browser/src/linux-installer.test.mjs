import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const wrapper = new URL(
  "../../../skills/ego-browser/scripts/install-linux.sh",
  import.meta.url,
);

test(
  "Linux install wrapper invokes the artifact installer without losing quoted arguments",
  { skip: process.platform !== "linux" },
  async () => {
    const artifact = await mkdtemp(join(tmpdir(), "ego artifact with spaces "));
    try {
      await mkdir(join(artifact, "host/scripts"), { recursive: true });
      await writeFile(
        join(artifact, "host/scripts/install.mjs"),
        "console.log(JSON.stringify(process.argv.slice(2)))",
      );
      const args = [
        "--artifact",
        artifact,
        "--prefix",
        join(artifact, "prefix with spaces"),
        "--no-desktop",
      ];
      const actual = JSON.parse(
        execFileSync("sh", [wrapper.pathname, ...args], { encoding: "utf8" }),
      );
      assert.deepEqual(actual, args);
    } finally {
      await rm(artifact, { recursive: true, force: true });
    }
  },
);
