import test from "node:test";
import assert from "node:assert/strict";
import { LinuxHost } from "../dist/src/host.js";

function chromeFixture(
  detachBeforeDiscovery = false,
  nested = false,
  omitRootFrame = false,
  sameProcessParent = false,
) {
  let nextSession = 0;
  let treeReads = 0;
  const sessions = new Map();
  const calls = [];
  const chrome = {
    generation: "fixture-generation",
    headless: false,
    bridge: {
      onEvent() {},
      async call(method, params = {}, sessionId) {
        calls.push({ method, params, sessionId });
        if (method === "Target.createTarget") return { targetId: "owned-page" };
        if (method === "Target.getTargets")
          return {
            targetInfos: [
              {
                targetId: "owned-page",
                type: "page",
                browserContextId: "shared",
              },
              {
                targetId: "owned-frame",
                type: "iframe",
                browserContextId: "shared",
              },
              {
                targetId: "personal-frame",
                type: "iframe",
                browserContextId: "shared",
              },
              ...(nested
                ? [
                    {
                      targetId: "nested-frame",
                      type: "iframe",
                      browserContextId: "shared",
                    },
                  ]
                : []),
            ],
          };
        if (method === "Target.attachToTarget") {
          const sessionId = "session-" + ++nextSession;
          sessions.set(sessionId, params.targetId);
          return { sessionId };
        }
        if (method === "Target.detachFromTarget") {
          sessions.delete(params.sessionId);
          return {};
        }
        const target = sessions.get(sessionId);
        if (method === "Page.getFrameTree") {
          treeReads++;
          return {
            frameTree: {
              frame: { id: target },
              ...(target === "owned-page" &&
              !omitRootFrame &&
              (!detachBeforeDiscovery || treeReads === 1)
                ? {
                    childFrames: [
                      {
                        frame: {
                          id: sameProcessParent ? "local-frame" : "owned-frame",
                        },
                      },
                    ],
                  }
                : {}),
              ...(nested && target === "owned-frame"
                ? { childFrames: [{ frame: { id: "nested-frame" } }] }
                : {}),
            },
          };
        }
        if (method === "DOM.getFrameOwner")
          return {
            backendNodeId:
              params.frameId === "nested-frame" ||
              (sameProcessParent && params.frameId === "owned-frame")
                ? 3
                : 2,
          };
        if (method === "Accessibility.enable") return {};
        if (method === "DOM.describeNode")
          return {
            node: {
              backendNodeId: params.backendNodeId,
              ...(target === "owned-page" &&
              (!detachBeforeDiscovery || treeReads === 1)
                ? {
                    frameId:
                      sameProcessParent && params.backendNodeId === 2
                        ? "local-frame"
                        : "owned-frame",
                  }
                : target === "owned-frame" && nested
                  ? { frameId: "nested-frame" }
                  : {}),
            },
          };
        if (method === "Accessibility.getFullAXTree") {
          if (
            params.frameId !== target &&
            !(
              sameProcessParent &&
              target === "owned-page" &&
              params.frameId === "local-frame"
            )
          )
            throw new Error("Frame renderer is separate");
          const node = (
            nodeId,
            role,
            backendDOMNodeId,
            name,
            childIds = [],
          ) => ({
            nodeId,
            role: { value: role },
            backendDOMNodeId,
            name: { value: name },
            childIds,
            ignored: false,
          });
          return {
            nodes:
              sameProcessParent && params.frameId === "local-frame"
                ? [
                    node("root", "RootWebArea", 4, "", ["frame"]),
                    node("frame", "Iframe", 3, "Nested remote frame"),
                  ]
                : target === "owned-page"
                  ? [
                      node("root", "RootWebArea", 1, "", ["frame"]),
                      node("frame", "Iframe", 2, "Owned frame"),
                    ]
                  : target === "owned-frame" && nested
                    ? [
                        node("root", "RootWebArea", 1, "", ["frame"]),
                        node("frame", "Iframe", 3, "Nested frame"),
                      ]
                    : [
                        node("root", "RootWebArea", 1, "", ["action"]),
                        node(
                          "action",
                          "button",
                          2,
                          target === "nested-frame"
                            ? "Nested action"
                            : "Owned action",
                        ),
                      ],
          };
        }
        return {};
      },
    },
  };
  return { chrome, calls };
}

// Catches authorizing every iframe in a shared BrowserContext instead of only
// frames in Chromium's trusted topology beneath this task's own page.
test("snapshot OOPIF discovery authorizes descendants and rejects foreign shared-profile frames", async () => {
  const fixture = chromeFixture();
  const host = new LinuxHost(fixture.chrome, "default", []);
  const client = host.add("client", "agent", () => {});
  const task = await host.dispatch(client, "createTaskSpace", ["snapshot"]);
  const lease = host.acquire(client, task.id);
  const snapshot = await host.dispatch(client, "snapshot", [], lease);
  assert.match(snapshot.content, /Owned action/);
  assert.equal(
    snapshot.refs.find((ref) => ref.name === "Owned action").frameId,
    "owned-frame",
  );
  await assert.rejects(
    () =>
      host.dispatch(
        client,
        "cdp",
        [
          {
            method: "Target.attachToTarget",
            params: { targetId: "personal-frame" },
          },
        ],
        lease,
      ),
    /does not belong/,
  );
  assert(
    !fixture.calls.some(
      ({ method, params }) =>
        method === "Target.attachToTarget" &&
        params.targetId === "personal-frame",
    ),
  );
  const visible = await host.dispatch(
    client,
    "cdp",
    [{ method: "Target.getTargets" }],
    lease,
  );
  assert.deepEqual(
    visible.targetInfos.map((target) => target.targetId).sort(),
    ["owned-frame", "owned-page"],
  );
});

// Catches using a stale frame inventory to attach after the frame has left
// this page; the current browser topology must still prove membership.
test("snapshot discovery rejects a frame detached before attachment", async () => {
  const fixture = chromeFixture(true);
  const host = new LinuxHost(fixture.chrome, "default", []);
  const client = host.add("client", "agent", () => {});
  const task = await host.dispatch(client, "createTaskSpace", ["snapshot"]);
  const lease = host.acquire(client, task.id);
  await assert.rejects(
    () => host.dispatch(client, "snapshot", [], lease),
    /Frame renderer|frame/i,
  );
  assert(
    !fixture.calls.some(
      ({ method, params }) =>
        method === "Target.attachToTarget" && params.targetId === "owned-frame",
    ),
  );
});

// Catches retaining the first target inventory after a newly attached renderer
// reveals an additional OOPIF that was absent from its parent's frame tree.
test("nested OOPIF discovery extends only through verified owned frame sessions", async () => {
  const fixture = chromeFixture(false, true);
  const host = new LinuxHost(fixture.chrome, "default", []);
  const client = host.add("client", "agent", () => {});
  const task = await host.dispatch(client, "createTaskSpace", ["snapshot"]);
  const lease = host.acquire(client, task.id);
  const snapshot = await host.dispatch(client, "snapshot", [], lease);
  assert.match(snapshot.content, /Nested action/);
  assert.equal(
    snapshot.refs.find((ref) => ref.name === "Nested action").frameId,
    "nested-frame",
  );
  assert(
    !fixture.calls.some(
      ({ method, params }) =>
        method === "Target.attachToTarget" &&
        params.targetId === "personal-frame",
    ),
  );
});

// Catches denying legitimate OOPIFs omitted by Page.getFrameTree without
// broadening authority to another tab's same-profile iframe target.
test("trusted DOM frame-owner metadata supplements an incomplete renderer tree", async () => {
  const fixture = chromeFixture(false, true, true);
  const host = new LinuxHost(fixture.chrome, "default", []);
  const client = host.add("client", "agent", () => {});
  const task = await host.dispatch(client, "createTaskSpace", ["snapshot"]);
  const lease = host.acquire(client, task.id);
  const snapshot = await host.dispatch(client, "snapshot", [], lease);
  assert.match(snapshot.content, /Nested action/);
  assert.equal(
    snapshot.refs.find((ref) => ref.name === "Nested action").frameId,
    "nested-frame",
  );
  await assert.rejects(
    () =>
      host.dispatch(
        client,
        "cdp",
        [
          {
            method: "Target.attachToTarget",
            params: { targetId: "personal-frame" },
          },
        ],
        lease,
      ),
    /does not belong/,
  );
});

// Catches assuming that every frame with remote children has its own target
// session; an ordinary same-process iframe can own an OOPIF as well.
test("a same-process frame can prove ownership of its remote child renderer", async () => {
  const fixture = chromeFixture(false, false, false, true);
  const host = new LinuxHost(fixture.chrome, "default", []);
  const client = host.add("client", "agent", () => {});
  const task = await host.dispatch(client, "createTaskSpace", ["snapshot"]);
  const lease = host.acquire(client, task.id);
  const snapshot = await host.dispatch(client, "snapshot", [], lease);
  assert.match(snapshot.content, /Owned action/);
  assert.equal(
    snapshot.refs.find((ref) => ref.name === "Owned action").frameId,
    "owned-frame",
  );
});
