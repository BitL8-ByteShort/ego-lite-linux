import test from "node:test";
import assert from "node:assert/strict";
import { LinuxHost } from "../dist/src/host.js";
const fake = () => {
  let n = 0;
  return {
    generation: "g",
    headless: false,
    bridge: {
      onEvent: () => {},
      call: async (method, p) => {
        if (method === "Target.createTarget")
          return { targetId: `target-${++n}` };
        if (method === "Target.attachToTarget")
          return { sessionId: `session-${++n}` };
        if (method === "Target.getTargets")
          return {
            targetInfos: [
              { targetId: "personal", type: "page" },
              { targetId: "target-1", type: "page" },
              { targetId: "target-2", type: "page" },
            ],
          };
        return {};
      },
    },
  };
};
test("same-context personal and other agent targets never authorize; selection and sessions are connection scoped", async () => {
  const h = new LinuxHost(fake(), "default", []);
  const a = h.add("A", "A", () => {}),
    b = h.add("B", "B", () => {});
  const ta = await h.dispatch(a, "createTaskSpace", ["A"]);
  const tb = await h.dispatch(b, "createTaskSpace", ["B"]);
  const la = h.acquire(a, ta.id),
    lb = h.acquire(b, tb.id);
  const tabs = await h.dispatch(a, "listTabs", [], la);
  assert.deepEqual(
    tabs.tabs.map((t) => t.targetId),
    ["target-1"],
  );
  await assert.rejects(
    h.dispatch(
      b,
      "cdp",
      [{ method: "Target.attachToTarget", params: { targetId: "target-1" } }],
      lb,
    ),
  );
  await assert.rejects(
    h.dispatch(
      a,
      "cdp",
      [{ method: "Target.closeTarget", params: { targetId: "personal" } }],
      la,
    ),
  );
  const s = await h.dispatch(
    a,
    "cdp",
    [{ method: "Target.attachToTarget", params: { targetId: "target-1" } }],
    la,
  );
  await assert.rejects(
    h.dispatch(
      b,
      "cdp",
      [
        {
          method: "Runtime.evaluate",
          sessionId: s.sessionId,
          params: { expression: "1" },
        },
      ],
      lb,
    ),
  );
  await h.pause(ta.id);
  await assert.rejects(
    h.dispatch(
      a,
      "cdp",
      [
        {
          method: "Runtime.evaluate",
          sessionId: s.sessionId,
          params: { expression: "1" },
        },
      ],
      la,
    ),
  );
  assert.ok(await h.dispatch(b, "listTabs", [], lb));
});
test("pause wins during a long CDP response and another task continues; no stale events deliver", async () => {
  const chrome = fake();
  let resolvePending;
  const original = chrome.bridge.call;
  chrome.bridge.call = (method, p, s) =>
    method === "Runtime.evaluate"
      ? new Promise((r) => (resolvePending = r))
      : original(method, p, s);
  const events = [];
  const h = new LinuxHost(chrome, "default", []),
    a = h.add("A", "A", (e) => events.push(e)),
    b = h.add("B", "B", () => {});
  const ta = await h.dispatch(a, "createTaskSpace", ["A"]),
    tb = await h.dispatch(b, "createTaskSpace", ["B"]);
  const la = h.acquire(a, ta.id),
    lb = h.acquire(b, tb.id);
  const { sessionId } = await h.dispatch(
    a,
    "cdp",
    [{ method: "Target.attachToTarget", params: { targetId: "target-1" } }],
    la,
  );
  const pending = h.dispatch(
    a,
    "cdp",
    [{ method: "Runtime.evaluate", sessionId, params: { expression: "long" } }],
    la,
  );
  const rejected = assert.rejects(pending, {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  await h.pause(ta.id);
  assert.ok(await h.dispatch(b, "listTabs", [], lb));
  chrome.bridge.onEvent({
    method: "Page.loadEventFired",
    sessionId,
    params: {},
  });
  assert.equal(events.length, 0);
  resolvePending({ result: { value: "too late" } });
  await rejected;
  await assert.rejects(h.dispatch(a, "takeOver", [ta.id]), /paused/);
});
test("task pages get independent background windows with rendered surfaces and never activate physical focus", async () => {
  const chrome = fake(),
    calls = [];
  const original = chrome.bridge.call;
  chrome.bridge.call = (m, p, s) => {
    calls.push([m, p]);
    return original(m, p, s);
  };
  const host = new LinuxHost(chrome, "default", []),
    client = host.add("client", "A", () => {});
  await host.dispatch(client, "createTaskSpace", ["task"]);
  const [, args] = calls.find(([m]) => m === "Target.createTarget");
  assert.equal(args.background, true);
  assert.equal(args.newWindow, true);
  assert.ok(!calls.some(([m]) => m === "Target.activateTarget"));
});
test("only explicit human assignment adopts inbox tabs, controller targets stay unavailable", async () => {
  const h = new LinuxHost(fake(), "default", []),
    c = h.add("c", "A", () => {});
  const t = await h.dispatch(c, "createTaskSpace", ["task"]);
  h.reserveTarget("controller");
  await assert.rejects(h.assignInbox(t.id, "controller"), /reserved|inbox/);
  const inbox = await h.inbox();
  assert.deepEqual(inbox.map((t) => t.targetId).sort(), [
    "personal",
    "target-2",
  ]);
  await h.assignInbox(t.id, "personal");
  const l = h.acquire(c, t.id);
  const tabs = await h.dispatch(c, "listTabs", [], l);
  assert.ok(tabs.tabs.some((t) => t.targetId === "personal"));
});
