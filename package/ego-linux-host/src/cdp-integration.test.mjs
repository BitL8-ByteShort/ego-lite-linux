import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CdpBridge } from "../dist/src/cdp-bridge.js";
import { LinuxHost } from "../dist/src/host.js";
import { createEgoAdapter } from "../dist/src/ego-client.js";

test("a bridge timeout stays request scoped as a CDP error", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const bridge = new CdpBridge(input, output, 10);
  try {
    await assert.rejects(bridge.call("Runtime.evaluate"), (error) => {
      assert.equal(error.code, -32000);
      assert.equal(error.error_code, undefined);
      return true;
    });
  } finally {
    bridge.close();
  }
});

test("closing the bridge destroys its readable pipe even if a descendant keeps the writer open", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const bridge = new CdpBridge(input, output);
  const pending = assert.rejects(bridge.call("Page.getFrameTree"), /closed/);
  bridge.close();
  assert.equal(output.destroyed, true);
  assert.equal(input.destroyed, true);
  await pending;
});

async function setup() {
  const calls = [],
    events = [];
  let nextTarget = 0,
    nextSession = 0;
  const chrome = {
    generation: "generation",
    bridge: {
      call: async (method, params = {}, sessionId, timeoutMs) => {
        calls.push({ method, params, sessionId, timeoutMs });
        if (method === "Target.createTarget")
          return { targetId: `page-${++nextTarget}` };
        if (method === "Target.attachToTarget")
          return { sessionId: `session-${++nextSession}` };
        if (
          method === "Target.detachFromTarget" &&
          params.sessionId === "child" &&
          sessionId !== "session-1"
        ) {
          throw Object.assign(new Error("No session with given id"), {
            code: -32602,
          });
        }
        return {};
      },
    },
  };
  const host = new LinuxHost(chrome, "default", []);
  const client = host.add("client", "agent", (event) => events.push(event));
  const task = await host.dispatch(client, "createTaskSpace", ["task"]);
  chrome.bridge.onEvent({
    method: "Target.targetInfoChanged",
    params: { targetInfo: { targetId: "page-1", type: "page" } },
  });
  const lease = host.acquire(client, task.id);
  const command = (method, params = {}, sessionId = "session-1") =>
    host.dispatch(client, "cdp", [{ id: 1, method, params, sessionId }], lease);
  await host.dispatch(
    client,
    "cdp",
    [{ method: "Target.attachToTarget", params: { targetId: "page-1" } }],
    lease,
  );
  return { host, chrome, command, calls, events, task };
}

test("pause rejects an in-flight command without waiting for Chrome to answer and another task continues", async () => {
  const { host, chrome, command, task } = await setup();
  const original = chrome.bridge.call;
  chrome.bridge.call = (method, ...args) =>
    method === "Runtime.evaluate"
      ? new Promise(() => {})
      : original(method, ...args);
  const rejection = assert.rejects(
    command("Runtime.evaluate", { expression: "blocked" }),
    { error_code: "EGO_TASK_SPACE_USER_IN_CONTROL" },
  );
  await host.pause(task.id);
  let timer;
  try {
    await Promise.race([
      rejection,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("pause left the response pending")),
          100,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const other = host.add("other", "other-agent", () => {});
  const otherTask = await host.dispatch(other, "createTaskSpace", [
    "other task",
  ]);
  const lease = host.acquire(other, otherTask.id);
  assert.deepEqual(
    await host.dispatch(
      other,
      "cdp",
      [{ method: "Browser.getVersion" }],
      lease,
    ),
    {},
  );
});

test("forwarded SDK commands leave time for the SDK's own request deadline", async () => {
  const { command, calls } = await setup();
  await command("Runtime.evaluate", { expression: "1" });
  assert.equal(
    calls.find((call) => call.method === "Runtime.evaluate").timeoutMs,
    60_000,
  );
});

test("task root sessions emulate focus without activating a window and worker sessions do not", async () => {
  const { command, chrome, calls } = await setup();
  assert.deepEqual(
    calls.filter(
      (call) => call.method === "Emulation.setFocusEmulationEnabled",
    ),
    [
      {
        method: "Emulation.setFocusEmulationEnabled",
        params: { enabled: true },
        sessionId: "session-1",
        timeoutMs: 500,
      },
    ],
  );
  assert.equal(
    calls.some((call) => call.method === "Target.activateTarget"),
    false,
  );
  chrome.bridge.onEvent({
    method: "Target.attachedToTarget",
    sessionId: "session-1",
    params: {
      sessionId: "child",
      targetInfo: { targetId: "worker", type: "worker" },
    },
  });
  await command("Target.attachToTarget", { targetId: "worker" });
  assert.equal(
    calls.filter((call) => call.method === "Emulation.setFocusEmulationEnabled")
      .length,
    1,
  );
});

test("nested flat sessions detach through their verified parent", async () => {
  const { command, chrome, calls } = await setup();
  chrome.bridge.onEvent({
    method: "Target.attachedToTarget",
    sessionId: "session-1",
    params: {
      sessionId: "child",
      targetInfo: { targetId: "worker", type: "worker" },
    },
  });
  await command("Target.detachFromTarget", { sessionId: "child" });
  const detach = calls.find(
    (call) => call.method === "Target.detachFromTarget",
  );
  assert.equal(detach.sessionId, "session-1");
  await assert.rejects(
    command("Runtime.evaluate", { expression: "1" }, "child"),
    { error_code: "EGO_CDP_SEND_FAILED" },
  );
});

test("the automation compatibility domain suppresses console events per session and supports ping", async () => {
  const { command, chrome, events } = await setup();
  assert.deepEqual(await command("egoAutomated.ping"), { result: "pong" });
  await command("egoAutomated.enable");
  const event = {
    method: "Runtime.consoleAPICalled",
    sessionId: "session-1",
    params: { args: [{ value: "fixture" }] },
  };
  chrome.bridge.onEvent(event);
  assert.equal(events.length, 0);
  await command("egoAutomated.disable");
  chrome.bridge.onEvent(event);
  assert.equal(events.length, 1);
  chrome.bridge.onEvent({
    method: "Page.loadEventFired",
    sessionId: "session-1",
    params: {},
  });
  assert.equal(events.length, 2);
  await command("egoAutomated.enable");
  chrome.bridge.onEvent(event);
  assert.equal(events.length, 2);
  const other = await command("Target.attachToTarget", { targetId: "page-1" });
  await command("egoAutomated.disable");
  chrome.bridge.onEvent({ ...event, sessionId: other.sessionId });
  assert.equal(events.length, 2);
  chrome.bridge.onEvent(event);
  assert.equal(events.length, 3);
  await assert.rejects(command("egoAutomated.unknown"), {
    error_code: "EGO_CDP_SEND_FAILED",
  });
});

test("raw Page download events cannot overtake the router's copied-file receipt", async () => {
  const { host, chrome, events } = await setup();
  host.initializeDownloads("/tmp/fixture-download-root");
  for (const method of ["Page.downloadWillBegin", "Page.downloadProgress"]) {
    chrome.bridge.onEvent({
      method,
      sessionId: "session-1",
      params: { guid: "fixture", state: "completed" },
    });
  }
  assert.equal(events.length, 0);
});

test("the adapter keeps numeric protocol errors on the original request instead of the native global callback", async () => {
  const connection = {
    async call(method) {
      if (method === "acquire") return {};
      throw Object.assign(new Error("Invalid expression"), {
        code: -32602,
        error_code: "EGO_OPERATION_FAILED",
      });
    },
  };
  const ego = createEgoAdapter(connection, {});
  ego.useTaskSpace(1);
  const response = new Promise((resolve) => {
    ego.onCDPMessage = (payload) => resolve({ message: JSON.parse(payload) });
    ego.onSendCDPMessageError = (message, error_code) =>
      resolve({ native: { message, error_code } });
  });
  ego.sendCDPMessage(
    JSON.stringify({
      id: 7,
      method: "Runtime.evaluate",
      sessionId: "page-session",
      params: { expression: "bad" },
    }),
  );
  assert.deepEqual(await response, {
    message: {
      id: 7,
      sessionId: "page-session",
      error: { code: -32602, message: "Invalid expression" },
    },
  });
});

test("explicit host policy errors retain their native error callback", async () => {
  const connection = {
    async call(method) {
      if (method === "acquire") return {};
      throw Object.assign(new Error("Foreign session"), {
        error_code: "EGO_CDP_SEND_FAILED",
      });
    },
  };
  const ego = createEgoAdapter(connection, {});
  ego.useTaskSpace(1);
  const response = new Promise((resolve) => {
    ego.onCDPMessage = (payload) => resolve({ message: JSON.parse(payload) });
    ego.onSendCDPMessageError = (message, error_code) =>
      resolve({ native: { message, error_code } });
  });
  ego.sendCDPMessage(
    JSON.stringify({ id: 7, method: "Runtime.evaluate", sessionId: "foreign" }),
  );
  assert.deepEqual(await response, {
    native: { message: "Foreign session", error_code: "EGO_CDP_SEND_FAILED" },
  });
});
test("scoped child attach preserves the SDK debugger wait so network tracking starts before navigation", async () => {
  const { command, calls } = await setup();
  await command("Target.setAutoAttach", {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: true,
  });
  const auto = calls.find((c) => c.method === "Target.setAutoAttach");
  assert.equal(auto.params.waitForDebuggerOnStart, true);
  assert.equal(auto.sessionId, "session-1");
  assert.deepEqual(auto.params.filter, [
    { type: "iframe", exclude: false },
    { type: "worker", exclude: false },
    { exclude: true },
  ]);
});
test("renderer focus setup cannot turn successful target attachment into a transport failure", async () => {
  const calls = [];
  const chrome = {
    generation: "g",
    bridge: {
      call: async (method, params) => {
        calls.push(method);
        if (method === "Target.createTarget") return { targetId: "page" };
        if (method === "Target.getTargets")
          return { targetInfos: [{ targetId: "page", type: "page" }] };
        if (method === "Target.attachToTarget") return { sessionId: "session" };
        if (method === "Emulation.setFocusEmulationEnabled")
          throw Object.assign(Error("renderer awaiting navigation"), {
            code: -32000,
          });
        return {};
      },
    },
  };
  const host = new LinuxHost(chrome, "default", []),
    client = host.add("c", "A", () => {}),
    task = await host.dispatch(client, "createTaskSpace", ["t"]),
    lease = host.acquire(client, task.id);
  await host.dispatch(client, "listTabs", [], lease);
  const attached = await host.dispatch(
    client,
    "cdp",
    [
      {
        method: "Target.attachToTarget",
        params: { targetId: "page", flatten: true },
      },
    ],
    lease,
  );
  assert.equal(attached.sessionId, "session");
});
