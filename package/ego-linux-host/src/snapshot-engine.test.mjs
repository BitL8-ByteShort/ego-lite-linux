import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { LinuxSnapshot } from "../dist/src/snapshot-engine.js";

// The transport is external Chromium. This double supplies protocol trees and
// executes the actual DOM inspection function against small document fixtures.
function browser({ frames, targets = [], owners = {}, elements = {} }) {
  const sessions = { main: "main", remote: "remote" };
  const calls = [];
  const documents = new Map();
  for (const [key, value] of Object.entries(elements)) {
    const frame = key.split(":")[0];
    if (!documents.has(frame)) {
      const doc = {
        defaultView: {
          innerWidth: 800,
          innerHeight: 600,
          getComputedStyle: (el) => el.style,
        },
        querySelectorAll: (selector) =>
          [...documents.get(frame).nodes].filter((el) => {
            if (el.inShadow) return false;
            if (selector === "*") return true;
            if (selector.startsWith("#"))
              return el.id === selector.slice(1).replace(/\\(.)/g, "$1");
            if (selector === "[href]") return el.href !== undefined;
            if (selector === "a[href]")
              return el.href !== undefined && el.tagName === "A";
            return false;
          }),
        nodes: [],
        nodeType: 9,
        baseURI: "https://fixture.test/" + frame,
      };
      documents.set(frame, doc);
    }
    const rect = value.rect ?? {
      left: 0,
      top: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
    };
    const el = {
      nodeType: 1,
      tagName: value.href === undefined ? "BUTTON" : "A",
      id: "",
      style: {
        visibility: "visible",
        display: "block",
        overflowX: "visible",
        overflowY: "visible",
      },
      getBoundingClientRect: () => rect,
      getClientRects: () => [rect],
      getAttribute: (name) => (name === "href" ? (value.href ?? null) : null),
      ownerDocument: documents.get(frame),
      parentElement: null,
      ...value,
    };
    documents.get(frame).nodes.push(el);
    elements[key] = el;
  }
  for (const element of Object.values(elements)) {
    if (element.parentKey) element.parentElement = elements[element.parentKey];
  }
  const cdp = async (method, params = {}, session = "main") => {
    calls.push({ method, params, session });
    if (method === "Page.getFrameTree")
      return { frameTree: frames[session].tree };
    if (
      method === "Accessibility.enable" ||
      method === "Runtime.releaseObjectGroup" ||
      method === "Target.detachFromTarget"
    )
      return {};
    if (method === "Target.getTargets") return { targetInfos: targets };
    if (method === "Target.attachToTarget") {
      assert(
        targets.some(
          (target) =>
            target.targetId === params.targetId && target.type === "iframe",
        ),
      );
      return { sessionId: sessions[params.targetId] ?? params.targetId };
    }
    if (method === "Accessibility.getFullAXTree") {
      const nodes = frames[session].ax[params.frameId];
      if (!nodes) throw new Error("Frame is in another renderer");
      return { nodes };
    }
    if (method === "DOM.getFrameOwner")
      return { backendNodeId: owners[params.frameId] };
    if (method === "DOM.resolveNode") {
      const document = Object.entries(frames[session].ax).find(
        ([, nodes]) => nodes[0]?.backendDOMNodeId === params.backendNodeId,
      );
      if (document)
        return {
          object: {
            type: "object",
            subtype: "node",
            objectId: "document:" + document[0],
          },
        };
      const candidates = Object.keys(elements).filter(
        (key) =>
          key.endsWith(":" + params.backendNodeId) &&
          frames[session].ax[key.split(":")[0]],
      );
      if (candidates.length !== 1)
        throw new Error("Node not available in this renderer");
      return {
        object: { type: "object", subtype: "node", objectId: candidates[0] },
      };
    }
    if (method === "Runtime.callFunctionOn") {
      const element = params.objectId.startsWith("document:")
        ? documents.get(params.objectId.slice(9))
        : elements[params.objectId];
      assert(element, "object belongs to this fixture");
      const context = vm.createContext({
        URL,
        CSS: { escape: (id) => id.replace(/([^a-zA-Z0-9_-])/g, "\\$1") },
      });
      const fn = vm.runInContext(
        "(" + params.functionDeclaration + ")",
        context,
      );
      return {
        result: {
          type: "object",
          value: fn.apply(
            element,
            (params.arguments ?? []).map((argument) => argument.value),
          ),
        },
      };
    }
    if (method === "DOM.describeNode") {
      const node = Object.values(frames[session].ax)
        .flat()
        .find((node) => node.backendDOMNodeId === params.backendNodeId);
      return {
        node: {
          backendNodeId: params.backendNodeId,
          frameId: node?.ownedFrameId,
        },
      };
    }
    throw new Error("Unexpected CDP call " + method);
  };
  return { cdp, calls };
}
const ax = (
  nodeId,
  role,
  name = "",
  backendDOMNodeId,
  childIds = [],
  extra = {},
) => ({
  nodeId,
  ignored: false,
  role: { type: "role", value: role },
  name: { type: "computedString", value: name },
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds,
  ...extra,
});
const frameTree = (id, children = []) => ({
  frame: { id, loaderId: "loader-" + id, url: "https://fixture.test/" + id },
  ...(children.length
    ? {
        childFrames: children.map((child) =>
          typeof child === "string" ? frameTree(child) : child,
        ),
      }
    : {}),
});

// Catches using renderer-local backend IDs as globally unique printed refs,
// dropping frame AX content, or discovering an unrelated iframe target.
test("main, same-process and OOPIF actions receive distinct refs with owning frames", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child", "remote"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["button", "f1", "f2"]),
            ax("button", "button", "Main action", 7),
            ax("f1", "Iframe", "Local frame", 10),
            ax("f2", "Iframe", "Remote frame", 11),
          ],
          child: [
            ax("root", "RootWebArea", "", 2, ["button"]),
            ax("button", "button", "Child action", 8),
          ],
        },
      },
      remote: {
        tree: frameTree("remote"),
        ax: {
          remote: [
            ax("root", "RootWebArea", "", 1, ["button"]),
            ax("button", "button", "Remote action", 7),
          ],
        },
      },
    },
    targets: [
      { targetId: "remote", type: "iframe" },
      { targetId: "unrelated", type: "iframe" },
    ],
    owners: { child: 10, remote: 11 },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot();
  const actions = result.refs.filter((ref) => ref.role === "button");
  assert.equal(actions.length, 3);
  assert.equal(
    new Set(result.refs.map((ref) => ref.refId)).size,
    result.refs.length,
  );
  assert.deepEqual(
    actions.map(({ backendNodeId, frameId, name }) => ({
      backendNodeId,
      frameId,
      name,
    })),
    [
      { backendNodeId: 7, frameId: undefined, name: "Main action" },
      { backendNodeId: 8, frameId: "child", name: "Child action" },
      { backendNodeId: 7, frameId: "remote", name: "Remote action" },
    ],
  );
  for (const ref of actions)
    assert.match(
      result.content,
      new RegExp("\\[ref=" + ref.refId + "(?:,|\\])"),
    );
  assert.equal(
    fixture.calls.filter(({ method }) =>
      /focus|activate|navigate/i.test(method),
    ).length,
    0,
  );
  assert.equal(
    fixture.calls.some(({ params }) => params.targetId === "unrelated"),
    false,
  );
});

// Catches losing text/group boundaries, duplicate inline text, and stripping
// empty semantic nodes while simplifying generic wrappers.
test("compaction is repeatable and preserves sibling groups and empty semantic nodes", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, [
              "empty",
              "wrap",
              "group1",
              "group2",
              "blank",
              "image",
              "svg",
              "canvas",
              "cell",
            ]),
            ax("empty", "generic", "", 2),
            ax("wrap", "generic", "", 3, ["wrap2"]),
            ax("wrap2", "generic", "", 4, ["button"]),
            ax("button", "button", "Save", 5, ["text"]),
            ax("text", "StaticText", "Keep page text", 6, ["inline"]),
            ax("inline", "InlineTextBox", "Keep page text", 7),
            ax("group1", "generic", "", 8, ["a", "b"]),
            ax("a", "StaticText", "A", 9),
            ax("b", "StaticText", "B", 10),
            ax("group2", "generic", "", 11, ["c", "d"]),
            ax("c", "StaticText", "C", 12),
            ax("d", "StaticText", "D", 13),
            ax("blank", "StaticText", " \u00a0\u200b\ufeff", 14),
            ax("image", "image", "", 15),
            ax("svg", "SvgRoot", "", 16),
            ax("canvas", "Canvas", "", 17),
            ax("cell", "cell", "", 18),
          ],
        },
      },
    },
  });
  const engine = new LinuxSnapshot(fixture.cdp, "main");
  const first = await engine.snapshot();
  assert.equal(first.content, (await engine.snapshot()).content);
  assert.equal(
    first.content,
    [
      "root",
      '  button "Save" [ref=1]',
      '    text "Keep page text"',
      "  container",
      '    text "A"',
      '    text "B"',
      "  container",
      '    text "C"',
      '    text "D"',
      "  image [ref=2]",
      "  svg_root [ref=3]",
      "  canvas [ref=4]",
      "  table_cell [ref=5]",
    ].join("\n"),
  );
  assert.deepEqual(
    first.refs.map((ref) => ref.backendNodeId),
    [5, 15, 16, 17, 18],
  );
});

// Catches silently treating zero as a zero-character cap, a cap that leaves
// refs for unprinted nodes, or interactiveOnly leaking ordinary page text.
test("unlimited and bounded snapshots keep exactly the printed refs and action states", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["text", "button", "check"]),
            ax("text", "StaticText", "Readable paragraph", 2),
            ax("button", "button", "Go", 3),
            ax("check", "checkbox", "Remember", 4, [], {
              properties: [
                { name: "checked", value: { value: false } },
                { name: "disabled", value: { value: true } },
              ],
            }),
          ],
        },
      },
    },
  });
  const engine = new LinuxSnapshot(fixture.cdp, "main");
  const all = await engine.snapshot({ maxResultLength: 0 });
  assert.match(all.content, /Readable paragraph/);
  assert.equal(all.refs.length, 2);
  const short = await engine.snapshot({ maxResultLength: 65 });
  assert(short.content.length <= 65);
  assert.deepEqual(
    short.refs.map((ref) => ref.name),
    ["Go"],
  );
  const actions = await engine.snapshot({
    interactiveOnly: true,
    includeActionMarks: true,
  });
  assert(!actions.content.includes("Readable paragraph"));
  assert.match(actions.content, /checked=false/);
  assert.match(actions.content, /disabled/);
  const plain = await engine.snapshot({ includeActionMarks: false });
  assert(!plain.content.includes("checked="));
  assert(!plain.content.includes("disabled"));
});

// Catches accepting an unknown/ambiguous native backend root or including its
// sibling nodes. This is the current backend-root API, not selector scoping.
test("subtree snapshots retain descendants and reject ambiguous or missing roots", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["button", "sibling", "frame"]),
            ax("button", "button", "Scoped", 7, ["text"]),
            ax("text", "StaticText", "Descendant", 8),
            ax("sibling", "button", "Sibling", 9),
            ax("frame", "Iframe", "Frame", 10),
          ],
          child: [
            ax("root", "RootWebArea", "", 20, ["button"]),
            ax("button", "button", "Child action", 7),
          ],
        },
      },
    },
    owners: { child: 10 },
  });
  const engine = new LinuxSnapshot(fixture.cdp, "main");
  const scoped = await engine.snapshot({ scope: "subtree", root: 10 });
  assert.match(scoped.content, /^iframe /);
  assert.match(scoped.content, /Child action/);
  assert(!scoped.content.includes("Sibling"));
  await assert.rejects(
    () => engine.snapshot({ scope: "subtree", root: 7 }),
    /ambiguous/i,
  );
  const mainRoot = await engine.snapshot({
    scope: "subtree",
    root: 7,
    rootFrameId: "main",
  });
  assert.match(mainRoot.content, /Descendant/);
  assert(!mainRoot.content.includes("Child action"));
  const childRoot = await engine.snapshot({
    scope: "subtree",
    root: 7,
    rootFrameId: "child",
  });
  assert.match(childRoot.content, /Child action/);
  assert(!childRoot.content.includes("Descendant"));
  await assert.rejects(
    () => engine.snapshot({ scope: "subtree", root: 404 }),
    /root.*(unavailable|not available|not found)/i,
  );
  await assert.rejects(() => engine.snapshot({ scope: "subtree" }), /root/i);
  await assert.rejects(
    () => engine.snapshot({ scope: "full_page", root: 9 }),
    /root/i,
  );
  await assert.rejects(
    () => engine.snapshot({ maxResultLength: -1 }),
    /maxResultLength/i,
  );
  await assert.rejects(() => engine.snapshot({ scope: "bad" }), /scope/i);
});

// Catches viewport capture leaking offscreen text/frame contents or discarding
// descendants just because a grouping ancestor has no visible box.
test("viewport clips text, overflow regions and offscreen iframe boundaries without changing full capture", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, [
              "visible",
              "offscreen",
              "frame",
              "group",
            ]),
            ax("visible", "button", "Visible", 2),
            ax("offscreen", "StaticText", "Below fold", 3),
            ax("frame", "Iframe", "Below frame", 4),
            ax("group", "generic", "", 5, ["outside"]),
            ax("outside", "button", "Clipped child", 6),
          ],
          child: [
            ax("root", "RootWebArea", "", 10, ["inside"]),
            ax("inside", "button", "Offscreen iframe action", 11),
          ],
        },
      },
    },
    owners: { child: 4 },
    elements: {
      "main:2": {},
      "main:3": {
        rect: {
          left: 0,
          top: 900,
          right: 100,
          bottom: 930,
          width: 100,
          height: 30,
        },
      },
      "main:4": {
        rect: {
          left: 0,
          top: 1000,
          right: 300,
          bottom: 1200,
          width: 300,
          height: 200,
        },
      },
      "main:5": {
        rect: {
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        },
        style: {
          visibility: "visible",
          display: "block",
          overflowX: "hidden",
          overflowY: "hidden",
        },
      },
      "main:6": {
        parentKey: "main:5",
        rect: {
          left: 200,
          top: 0,
          right: 300,
          bottom: 30,
          width: 100,
          height: 30,
        },
      },
      "child:11": {},
    },
  });
  const engine = new LinuxSnapshot(fixture.cdp, "main");
  const viewport = await engine.snapshot({ scope: "only_within_viewport" });
  assert.match(viewport.content, /Visible/);
  assert(!viewport.content.includes("Below fold"));
  assert(!viewport.content.includes("iframe"));
  assert(!viewport.content.includes("Clipped child"));
  assert.deepEqual(
    viewport.refs.map((ref) => ref.backendNodeId),
    [2],
  );
  const full = await engine.snapshot({ scope: "full_page" });
  assert.match(full.content, /Below fold/);
  assert.match(full.content, /Offscreen iframe action/);
  assert.match(full.content, /Clipped child/);
});

// Catches announcing an ID/href that selects multiple or different nodes,
// using the top document to prove a frame locator, or leaking shadow locators.
test("stable locators prove identity and uniqueness across every frame document", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, [
              "id",
              "duplicate1",
              "duplicate2",
              "href",
              "badHref",
              "shadow",
              "uniqueId",
              "frame",
            ]),
            ax("id", "button", "Save", 2),
            ax("duplicate1", "button", "Edit", 3),
            ax("duplicate2", "button", "Edit", 4),
            ax("href", "link", "Unique link", 5),
            ax("badHref", "link", "Duplicate link", 6),
            ax("shadow", "button", "Shadow action", 7),
            ax("uniqueId", "button", "Unique ID", 12),
            ax("frame", "Iframe", "Child", 8),
          ],
          child: [
            ax("root", "RootWebArea", "", 10, ["id"]),
            ax("id", "button", "Save", 11),
          ],
        },
      },
    },
    owners: { child: 8 },
    elements: {
      "main:2": { id: "save" },
      "main:3": { id: "editor" },
      "main:4": {
        id: "editor",
        style: { visibility: "hidden", display: "none" },
      },
      "main:5": { href: "/unique" },
      "main:6": { href: "/duplicate" },
      "main:7": { id: "shadow", inShadow: true },
      "main:8": {},
      "child:11": { id: "save" },
      "main:999": { href: "/duplicate" },
      "main:998": { id: "shadow" },
      "main:12": { id: "only-save" },
    },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot({
    includeStableLocator: true,
  });
  const locators = result.refs.map(({ backendNodeId, frameId, loc }) => ({
    backendNodeId,
    frameId,
    loc,
  }));
  assert.deepEqual(
    locators.filter((ref) => ref.loc),
    [
      { backendNodeId: 5, frameId: undefined, loc: "href:/unique" },
      { backendNodeId: 12, frameId: undefined, loc: "css:#only-save" },
    ],
  );
  assert(!result.content.includes("unstable"));
  assert(!result.content.includes("ambiguous"));
  assert.match(result.content, /loc=href:\/unique/);
  assert.equal(
    fixture.calls.filter(
      ({ method }) => method === "Runtime.releaseObjectGroup",
    ).length,
    1,
  );
});

// Catches sharing child IDs across siblings or caching an old frame topology
// after navigation/replacement. The engine must ask Chromium each capture.
test("nested and sibling frames retain boundaries and replacement drops the old document", async () => {
  const frames = {
    main: {
      tree: frameTree("main", [frameTree("first", ["nested"]), "second"]),
      ax: {
        main: [
          ax("root", "RootWebArea", "", 1, ["first", "second"]),
          ax("first", "Iframe", "First", 2),
          ax("second", "Iframe", "Second", 3),
        ],
        first: [
          ax("root", "RootWebArea", "", 4, ["text", "nested"]),
          ax("text", "StaticText", "First content", 5),
          ax("nested", "Iframe", "Nested", 6),
        ],
        nested: [
          ax("root", "RootWebArea", "", 7, ["button"]),
          ax("button", "button", "Nested action", 8),
        ],
        second: [
          ax("root", "RootWebArea", "", 9, ["button"]),
          ax("button", "button", "Second action", 10),
        ],
      },
    },
  };
  const fixture = browser({
    frames,
    owners: { first: 2, nested: 6, second: 3 },
  });
  const engine = new LinuxSnapshot(fixture.cdp, "main");
  const initial = await engine.snapshot();
  assert.match(
    initial.content,
    /iframe "First"[\s\S]*iframe "Nested"[\s\S]*Nested action[\s\S]*iframe "Second"[\s\S]*Second action/,
  );
  const first = await engine.snapshot({ scope: "subtree", root: 2 });
  assert.match(first.content, /Nested action/);
  assert(!first.content.includes("Second action"));
  const second = await engine.snapshot({ scope: "subtree", root: 3 });
  assert.match(second.content, /Second action/);
  assert(!second.content.includes("First content"));
  frames.main.tree = frameTree("replacement");
  frames.main.ax = {
    replacement: [
      ax("root", "RootWebArea", "", 11, ["button"]),
      ax("button", "button", "Replacement action", 12),
    ],
  };
  const replacement = await engine.snapshot();
  assert.match(replacement.content, /Replacement action/);
  assert(!replacement.content.includes("Nested action"));
  await assert.rejects(
    () => engine.snapshot({ scope: "subtree", root: 8 }),
    /root.*not available/i,
  );
});

// Catches silently succeeding with partial frame content when a renderer dies,
// and verifies failures still clean up objects/attachments owned by this call.
test("unavailable frames fail explicitly and release the snapshot's own sessions", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["remote"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["frame"]),
            ax("frame", "Iframe", "Remote", 2),
          ],
        },
      },
      remote: { tree: frameTree("remote"), ax: { remote: [] } },
    },
    targets: [{ targetId: "remote", type: "iframe" }],
    owners: { remote: 2 },
  });
  await assert.rejects(
    () => new LinuxSnapshot(fixture.cdp, "main").snapshot(),
    (error) => {
      assert.equal(error.error_code, "EGO_SNAPSHOT_FAILED");
      assert.match(error.message, /frame/i);
      return true;
    },
  );
  assert.deepEqual(
    fixture.calls
      .filter(({ method }) => method === "Target.detachFromTarget")
      .map(({ params }) => params.sessionId),
    ["remote"],
  );
});

// Catches returning a successful but incomplete snapshot if a discovered frame
// cannot be connected to a parent AX boundary.
test("a frame with an unavailable AX boundary does not silently disappear", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child"]),
        ax: {
          main: [ax("root", "RootWebArea", "", 1)],
          child: [
            ax("root", "RootWebArea", "", 2, ["button"]),
            ax("button", "button", "Lost frame action", 3),
          ],
        },
      },
    },
    owners: { child: 99 },
  });
  await assert.rejects(
    () => new LinuxSnapshot(fixture.cdp, "main").snapshot(),
    /frame.*(boundary|owner|unavailable)/i,
  );
});

// Catches visibility being checked only within an iframe, ignoring the clipped
// part of its parent viewport; a button outside that intersection must be absent.
test("partly visible iframe content is clipped to the parent viewport", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main", ["child"]),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["frame"]),
            ax("frame", "Iframe", "Partial", 2),
          ],
          child: [
            ax("root", "RootWebArea", "", 3, ["top", "bottom"]),
            ax("top", "button", "Visible top", 4),
            ax("bottom", "button", "Clipped bottom", 5),
          ],
        },
      },
    },
    owners: { child: 2 },
    elements: {
      "main:2": {
        rect: {
          left: 0,
          top: 550,
          right: 300,
          bottom: 750,
          width: 300,
          height: 200,
        },
      },
      "child:4": {
        rect: {
          left: 0,
          top: 5,
          right: 100,
          bottom: 25,
          width: 100,
          height: 20,
        },
      },
      "child:5": {
        rect: {
          left: 0,
          top: 100,
          right: 100,
          bottom: 120,
          width: 100,
          height: 20,
        },
      },
    },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot({
    scope: "only_within_viewport",
  });
  assert.match(result.content, /Visible top/);
  assert(!result.content.includes("Clipped bottom"));
});

// Catches a raw-href proof that misses an absolute/relative URL alias, or
// advertises a non-anchor node to the SDK's anchor-only href locator.
test("href locators normalize URL aliases and retain their source element type", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, [
              "relative",
              "absolute",
              "area",
              "unique",
            ]),
            ax("relative", "link", "Alias one", 2),
            ax("absolute", "link", "Alias two", 3),
            ax("area", "link", "Image map", 4),
            ax("unique", "link", "Unique", 5),
          ],
        },
      },
    },
    elements: {
      "main:2": { href: "/alias" },
      "main:3": { href: "https://fixture.test/alias" },
      "main:4": { href: "/area", tagName: "AREA" },
      "main:5": { href: "relative" },
    },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot({
    includeStableLocator: true,
  });
  assert.deepEqual(
    result.refs
      .filter((ref) => ref.loc)
      .map(({ name, loc }) => ({ name, loc })),
    [{ name: "Unique", loc: "href:/relative" }],
  );
});

// Chromium can omit an OOPIF from the parent renderer's Page frame tree while
// exposing its frame owner in AX/DOM. Dropping this path loses all remote text.
test("AX iframe owners discover OOPIFs absent from the renderer's frame tree", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["frame"]),
            ax("frame", "Iframe", "Remote", 2, [], { ownedFrameId: "remote" }),
          ],
        },
      },
      remote: {
        tree: frameTree("remote"),
        ax: {
          remote: [
            ax("root", "RootWebArea", "", 1, ["button"]),
            ax("button", "button", "Discovered OOPIF action", 2),
          ],
        },
      },
    },
    targets: [{ targetId: "remote", type: "iframe" }],
    owners: { remote: 2 },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot();
  assert.match(result.content, /Discovered OOPIF action/);
  assert.equal(
    result.refs.find((ref) => ref.name === "Discovered OOPIF action").frameId,
    "remote",
  );
});

// Catches snapshots hiding current form state, breaking indentation with an
// unescaped multiline value, or exposing a protected password value.
test("form values render as escaped JSON while protected values stay private", async () => {
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, [
              "input",
              "select",
              "textarea",
              "range",
              "password",
            ]),
            ax("input", "textbox", "Name", 2, [], {
              value: { type: "string", value: "Chris" },
            }),
            ax("select", "combobox", "Color", 3, [], {
              value: { type: "string", value: "Blue" },
            }),
            ax("textarea", "textbox", "Notes", 4, [], {
              value: { type: "string", value: 'Two\nlines"' },
            }),
            ax("range", "slider", "Volume", 5, [], {
              value: { type: "number", value: 0 },
            }),
            ax("password", "textbox", "Password", 6, [], {
              value: { type: "string", value: "private-value" },
              properties: [{ name: "protected", value: { value: true } }],
            }),
          ],
        },
      },
    },
  });
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot({
    includeActionMarks: false,
  });
  assert.match(result.content, /value="Chris"/);
  assert.match(result.content, /value="Blue"/);
  assert(result.content.includes('value="Two\\nlines\\\""'));
  assert.match(result.content, /value=0/);
  assert(!result.content.includes("private-value"));
  assert.equal(result.content.split("\n").length, 6);
});

// Catches proving a light-DOM ID unique while the SDK's deep CSS query would
// also match an element in an open shadow root.
test("stable locator uniqueness counts shadow-root matches as well as light DOM", async () => {
  const elements = {
    "main:2": { id: "save" },
    "main:3": { id: "shadow-host" },
    "main:4": { id: "save", inShadow: true },
  };
  const fixture = browser({
    frames: {
      main: {
        tree: frameTree("main"),
        ax: {
          main: [
            ax("root", "RootWebArea", "", 1, ["button"]),
            ax("button", "button", "Save", 2),
          ],
        },
      },
    },
    elements,
  });
  elements["main:3"].shadowRoot = {
    querySelectorAll: (selector) =>
      selector === "#save" ? [elements["main:4"]] : [],
  };
  const result = await new LinuxSnapshot(fixture.cdp, "main").snapshot({
    includeStableLocator: true,
  });
  assert.equal(
    result.refs.find((ref) => ref.backendNodeId === 2).loc,
    undefined,
  );
});
