import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DownloadRouter } from "../dist/src/downloads.js";
test("shared context downloads route by verified frame target; foreign and revoked events never deliver", async () => {
  const root = await mkdtemp(join(tmpdir(), "ego-router-")),
    a = await mkdtemp(join(tmpdir(), "ego-browser-download-")),
    b = await mkdtemp(join(tmpdir(), "ego-browser-download-"));
  let revoked = false;
  const events = [];
  try {
    const router = new DownloadRouter(
      root,
      (o) => !revoked,
      (o, e) => events.push([o.taskId, e]),
    );
    await router.arm("A", { taskId: 1, clientId: "A", epoch: 0 }, a);
    await router.arm("B", { taskId: 2, clientId: "B", epoch: 0 }, b);
    await router.event(
      {
        method: "Browser.downloadWillBegin",
        params: { frameId: "foreign", guid: "foreign", suggestedFilename: "x" },
      },
      (id) => (id === "frame-A" ? "A" : undefined),
    );
    assert.equal(events.length, 0);
    await router.event(
      {
        method: "Browser.downloadWillBegin",
        params: {
          frameId: "frame-A",
          guid: "one",
          suggestedFilename: "../safe.txt",
        },
      },
      () => "A",
    );
    await writeFile(join(root, "one"), "owned");
    await router.event(
      {
        method: "Browser.downloadProgress",
        params: {
          guid: "one",
          state: "completed",
          filePath: join(root, "one"),
        },
      },
      () => undefined,
    );
    assert.equal(await readFile(join(a, "safe.txt"), "utf8"), "owned");
    assert.equal(events.length, 2);
    assert.ok(events.every(([task]) => task === 1));
    revoked = true;
    await router.event(
      {
        method: "Browser.downloadWillBegin",
        params: { frameId: "frame-B", guid: "two" },
      },
      () => "B",
    );
    assert.equal(events.length, 2);
    await assert.rejects(router.arm("A", { taskId: 1 }, root));
  } finally {
    for (const dir of [root, a, b])
      await rm(dir, { recursive: true, force: true });
  }
});
test("Chromium reported normal destination is copied atomically; personal downloads stay untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "ego-normal-download-")),
    stage = await mkdtemp(join(tmpdir(), "ego-browser-download-"));
  const events = [];
  try {
    const router = new DownloadRouter(
      root,
      () => true,
      (o, e) => events.push(e),
    );
    await writeFile(join(root, "original.txt"), "complete original");
    await router.arm("task", { taskId: 1, clientId: "A", epoch: 0 }, stage);
    await router.event(
      {
        method: "Browser.downloadWillBegin",
        params: {
          frameId: "task",
          guid: "guid",
          suggestedFilename: "original.txt",
        },
      },
      (id) => id,
    );
    await router.event(
      {
        method: "Browser.downloadProgress",
        params: {
          guid: "guid",
          state: "completed",
          filePath: join(root, "original.txt"),
        },
      },
      () => undefined,
    );
    assert.equal(
      await readFile(join(stage, "original.txt"), "utf8"),
      "complete original",
    );
    assert.equal(events.at(-1).params.state, "completed");
    await writeFile(join(root, "personal.txt"), "personal");
    await router.event(
      {
        method: "Browser.downloadWillBegin",
        params: {
          frameId: "personal",
          guid: "personal",
          suggestedFilename: "personal.txt",
        },
      },
      () => undefined,
    );
    await router.event(
      {
        method: "Browser.downloadProgress",
        params: {
          guid: "personal",
          state: "completed",
          filePath: join(root, "personal.txt"),
        },
      },
      () => undefined,
    );
    assert.equal(
      await readFile(join(root, "personal.txt"), "utf8"),
      "personal",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
  }
});
test("automatic download allowance lasts only through owned interceptions and restores normal behavior", async () => {
  const root = await mkdtemp(join(tmpdir(), "ego-mode-")),
    a = await mkdtemp(join(tmpdir(), "ego-browser-download-")),
    b = await mkdtemp(join(tmpdir(), "ego-browser-download-"));
  const modes = [];
  let valid = true;
  try {
    const router = new DownloadRouter(
      root,
      () => valid,
      () => {},
      async (active) => {
        modes.push(active);
      },
    );
    await router.arm("A", { taskId: 1, clientId: "A" }, a);
    await router.arm("B", { taskId: 2, clientId: "B" }, b);
    await router.arm("A", { taskId: 1 }, undefined);
    assert.equal(modes.at(-1), true);
    router.disconnect("B");
    await router.arm("unused", {}, undefined);
    assert.equal(modes.at(-1), false);
    valid = false;
    await assert.rejects(
      router.arm("A", { taskId: 1, clientId: "A" }, a),
      /expired/,
    );
    assert.equal(modes.at(-1), false);
  } finally {
    for (const p of [root, a, b]) await rm(p, { recursive: true, force: true });
  }
});
