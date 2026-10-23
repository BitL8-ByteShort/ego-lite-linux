import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinuxHost } from "../dist/src/host.js";

// Catches choosing an old same-target session and breaking before the current
// SDK session receives its event, while preserving task/client isolation.
test("download events reach every current owner's matching session and no other task", async () => {
  let nextTarget = 0,
    nextSession = 0;
  const pages = [];
  const chrome = {
    generation: "downloads",
    bridge: {
      onEvent() {},
      async call(method, params = {}) {
        if (method === "Target.createTarget") {
          const targetId = "page-" + ++nextTarget;
          pages.push({ targetId, type: "page" });
          return { targetId };
        }
        if (method === "Target.attachToTarget")
          return { sessionId: "session-" + ++nextSession };
        if (method === "Target.getTargets") return { targetInfos: pages };
        return {};
      },
    },
  };
  const host = new LinuxHost(chrome, "default", []);
  const eventsA = [],
    eventsB = [];
  const a = host.add("a", "agent-a", (event) => eventsA.push(event));
  const b = host.add("b", "agent-b", (event) => eventsB.push(event));
  const taskA = await host.dispatch(a, "createTaskSpace", ["A"]);
  const taskB = await host.dispatch(b, "createTaskSpace", ["B"]);
  const leaseA = host.acquire(a, taskA.id),
    leaseB = host.acquire(b, taskB.id);
  const attach = (client, lease, targetId) =>
    host.dispatch(
      client,
      "cdp",
      [{ method: "Target.attachToTarget", params: { targetId } }],
      lease,
    );
  const first = await attach(a, leaseA, "page-1"),
    second = await attach(a, leaseA, "page-1");
  await attach(b, leaseB, "page-2");
  const directory = await mkdtemp(
    join(tmpdir(), "ego-browser-download-session-"),
  );
  try {
    host.initializeDownloads(directory);
    await host.dispatch(
      a,
      "cdp",
      [
        {
          method: "Page.setDownloadBehavior",
          sessionId: second.sessionId,
          params: { behavior: "allow", downloadPath: directory },
        },
      ],
      leaseA,
    );
    chrome.bridge.onEvent({
      method: "Browser.downloadWillBegin",
      params: {
        frameId: "page-1",
        guid: "fixture-guid",
        suggestedFilename: "fixture.txt",
        url: "https://fixture.test/download",
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(eventsA.map((event) => event.event.sessionId).sort(), [
      first.sessionId,
      second.sessionId,
    ]);
    assert(
      eventsA.every(
        (event) =>
          event.context.taskId === taskA.id &&
          event.event.method === "Page.downloadWillBegin",
      ),
    );
    assert.equal(eventsB.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
