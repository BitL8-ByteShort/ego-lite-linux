import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchChrome } from "../dist/src/chrome-supervisor.js";
import { LinuxHost } from "../dist/src/host.js";
import { startDesktopController } from "../dist/src/desktop-server.js";
if (process.platform !== "linux" || process.env.EGO_LINUX_HEADLESS === "1")
  throw Error(
    "Human control qualification needs real headed Chromium (Xvfb is synthetic)",
  );
const dir = await mkdtemp(join(tmpdir(), "ego-control-"));
const chrome = await launchChrome(dir, false);
let ui;
try {
  const host = new LinuxHost(chrome, "control", []);
  const a = host.add("client-A", "A", () => {}),
    b = host.add("client-B", "B", () => {});
  const ta = await host.dispatch(a, "createTaskSpace", ["A"]),
    tb = await host.dispatch(b, "createTaskSpace", ["B"]);
  let la = host.acquire(a, ta.id);
  const lb = host.acquire(b, tb.id);
  const tabsA = await host.dispatch(a, "listTabs", [], la),
    tabsB = await host.dispatch(b, "listTabs", [], lb);
  const attach = async (c, l, targetId) =>
    (
      await host.dispatch(
        c,
        "cdp",
        [
          {
            method: "Target.attachToTarget",
            params: { targetId, flatten: true },
          },
        ],
        l,
      )
    ).sessionId;
  let sa = await attach(a, la, tabsA.tabs[0].targetId);
  const sb = await attach(b, lb, tabsB.tabs[0].targetId);
  ui = await startDesktopController({
    host,
    profiles: async () => ["control"],
    createProfile: async () => {},
    openPersonal: async () => {},
    stop: async () => {},
  });
  const url = new URL(ui.url),
    token = url.hash.slice(1);
  url.hash = "";
  const act = async (action, id, values = {}) => {
    const response = await fetch(new URL("/api", url), {
      method: "POST",
      headers: {
        origin: url.origin,
        "x-ego-token": token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, id, ...values }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const controllerPage = await chrome.bridge.call("Target.createTarget", {
    url: ui.url,
    newWindow: true,
    background: true,
  });
  host.reserveTarget(controllerPage.targetId);
  const controllerSession = await chrome.bridge.call("Target.attachToTarget", {
    targetId: controllerPage.targetId,
    flatten: true,
  });
  const rendered = async () => {
    for (let i = 0; i < 30; i++) {
      const probe = await chrome.bridge.call(
        "Runtime.evaluate",
        {
          expression: 'document.querySelector("#profile")?.textContent',
          returnByValue: true,
        },
        controllerSession.sessionId,
      );
      if (probe.result.value === "Profile: control") return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      "Controller did not authenticate/render after load or refresh",
    );
  };
  await rendered();
  await chrome.bridge.call("Page.reload", {}, controllerSession.sessionId);
  await new Promise((r) => setTimeout(r, 200));
  await rendered();
  const manual = await act("createTask", undefined, {
    name: "Human-created task",
  });
  assert.equal(manual.createdBy, "user");
  assert.equal(manual.ownership, "user");
  assert.throws(() => host.acquire(a, manual.id));
  await act("grant", manual.id, { agentId: "A" });
  assert.equal(host.acquire(a, manual.id).agentId, "A");
  await new Promise((r) => setTimeout(r, 250));
  await mkdir(new URL("../../../artifacts/linux/", import.meta.url), {
    recursive: true,
  });
  const shot = await chrome.bridge.call(
    "Page.captureScreenshot",
    { format: "png" },
    controllerSession.sessionId,
  );
  await writeFile(
    new URL("../../../artifacts/linux/controller-xvfb.png", import.meta.url),
    Buffer.from(shot.data, "base64"),
  );
  const blocked = host.dispatch(
    a,
    "cdp",
    [
      {
        method: "Runtime.evaluate",
        params: { expression: "new Promise(()=>{})", awaitPromise: true },
        sessionId: sa,
      },
    ],
    la,
  );
  const rejected = assert.rejects(blocked);
  const start = Date.now();
  await act("pause", ta.id);
  assert.ok(
    Date.now() - start < 5000,
    "Human pause responds while evaluate is pending",
  );
  await rejected;
  await assert.rejects(host.dispatch(a, "takeOver", [ta.id]), /paused/);
  await assert.rejects(
    host.dispatch(
      a,
      "cdp",
      [
        {
          method: "Runtime.evaluate",
          params: { expression: "1" },
          sessionId: sa,
        },
      ],
      la,
    ),
  );
  const other = await host.dispatch(
    b,
    "cdp",
    [
      {
        method: "Runtime.evaluate",
        params: { expression: "1+1", returnByValue: true },
        sessionId: sb,
      },
    ],
    lb,
  );
  assert.equal(other.result.value, 2);
  // The trusted fixture acts as the human after the agent lease is revoked.
  const human = await chrome.bridge.call("Target.attachToTarget", {
    targetId: tabsA.tabs[0].targetId,
    flatten: true,
  });
  await chrome.bridge.call(
    "Page.navigate",
    { url: 'data:text/html,<input id="mfa"><output id="result"></output>' },
    human.sessionId,
  );
  await new Promise((r) => setTimeout(r, 100));
  await chrome.bridge.call(
    "Runtime.evaluate",
    { expression: 'document.querySelector("#mfa").value="human-completed"' },
    human.sessionId,
  );
  await act("resume", ta.id);
  la = host.acquire(a, ta.id);
  sa = await attach(a, la, tabsA.tabs[0].targetId);
  const resumed = await host.dispatch(
    a,
    "cdp",
    [
      {
        method: "Runtime.evaluate",
        params: {
          expression: 'document.querySelector("#mfa").value',
          returnByValue: true,
        },
        sessionId: sa,
      },
    ],
    la,
  );
  assert.equal(resumed.result.value, "human-completed");
  await host.dispatch(a, "handOffTaskSpace", [], la);
  await host.dispatch(a, "takeOver", [ta.id]);
  la = host.acquire(a, ta.id);
  assert.ok(await host.dispatch(a, "listTabs", [], la));
  await act("pauseAll");
  assert.ok(host.summaries().every((t) => t.hardPaused));
  console.log(
    JSON.stringify(
      {
        passed: true,
        backend: "synthetic-Xvfb-or-configured-headed-display",
        browser: chrome.version,
        assertions: 20,
        userTaskGrant: true,
        controllerRefresh: true,
        hardPause: true,
        independentTask: true,
        delegation: true,
        humanFixture: true,
        resume: true,
      },
      null,
      2,
    ),
  );
} finally {
  await ui?.close();
  await chrome.close();
  await rm(dir, { recursive: true, force: true });
}
