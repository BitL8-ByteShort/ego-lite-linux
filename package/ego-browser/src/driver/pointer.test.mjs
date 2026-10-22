import test from "node:test";
import assert from "node:assert/strict";

import { setOverrides } from "../../dist/src/state.js";
import { click, scroll } from "../../dist/src/driver/pointer.js";

test("click resolves selector offsets without the public elementEval helper", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (
        method === "Runtime.evaluate" &&
        params.objectGroup === "ego-browser"
      ) {
        return { result: { objectId: "object-1" } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: { x: 125, y: 225 } } };
      }
      if (method === "Runtime.callFunctionOn") {
        return { result: { value: { x: 100, y: 200 } } };
      }
      return {};
    },
  });
  try {
    await click({ selector: "#target", x: 12, y: 8 });
  } finally {
    restore();
  }

  const callFunction = calls.find(
    (call) => call.method === "Runtime.callFunctionOn",
  );
  assert.equal(callFunction.params.objectId, "object-1");
  assert.match(
    callFunction.params.functionDeclaration,
    /getBoundingClientRect/,
  );

  assert.ok(
    calls.some(
      (call) =>
        call.method === "Runtime.releaseObject" &&
        call.params.objectId === "object-1",
    ),
  );

  const mouseEvents = calls.filter(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  assert.deepEqual(
    mouseEvents.map((call) => ({
      type: call.params.type,
      x: call.params.x,
      y: call.params.y,
      button: call.params.button,
      buttons: call.params.buttons,
    })),
    [
      { type: "mouseMoved", x: 112, y: 208, button: "none", buttons: 0 },
      { type: "mousePressed", x: 112, y: 208, button: "left", buttons: 1 },
      { type: "mouseReleased", x: 112, y: 208, button: "left", buttons: 0 },
    ],
  );
});

test("scroll defaults to scrolling down (positive deltaY, DOM wheel convention)", async () => {
  // Regression: the default used to be deltaY -300, which scrolls UP — CDP
  // negates wheel deltas internally, so the DOM convention (positive = down)
  // applies end to end. SKILL.md documents scroll({ dy: 900 }) as a downward
  // scroll, matching scrollBy / scrollToBottomUntil.
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId, timeoutMs) {
      calls.push({ method, params, sessionId, timeoutMs });
      return {};
    },
  });
  try {
    await scroll();
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "Input.dispatchMouseEvent");
  assert.equal(calls[0].params.deltaY, 300);
  assert.equal(calls[0].params.deltaX, 0);
  assert.equal(
    calls[0].timeoutMs,
    15_000,
    "wheel dispatch uses the normal CDP timeout instead of a fragile one-second deadline",
  );
});

test("scroll falls back to DOM scrolling only when wheel dispatch is unsupported", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("'Input.dispatchMouseEvent' wasn't found");
      }
      if (method === "Runtime.evaluate") {
        return { result: { value: { x: 0, y: 450 } } };
      }
      return {};
    },
  });
  try {
    const result = await scroll({ x: 50, y: 60, dx: 10, dy: 450 });
    assert.deepEqual(result, { x: 0, y: 450 });
  } finally {
    restore();
  }

  assert.equal(calls[0].method, "Input.dispatchMouseEvent");
  assert.deepEqual(calls[0].params, {
    type: "mouseWheel",
    x: 50,
    y: 60,
    deltaX: 10,
    deltaY: 450,
  });
  assert.equal(calls[1].method, "Runtime.evaluate");
  assert.match(calls[1].params.expression, /window\.scrollBy/);
});

test("scroll propagates wheel dispatch timeouts instead of silently degrading", async () => {
  // Regression: any error (including timeouts and "user is controlling") used
  // to silently fall back to window.scrollBy, which is not equivalent to a
  // real wheel event and masked the original failure.
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method) {
      calls.push(method);
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await assert.rejects(() => scroll({ dy: 450 }), /timed out/);
  } finally {
    restore();
  }
  assert.deepEqual(calls, ["Input.dispatchMouseEvent"]);
});

test("scroll propagates user-control errors from wheel dispatch", async () => {
  const restore = setOverrides({
    cdpOverride(method) {
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("user is controlling this task space");
      }
      return {};
    },
  });
  try {
    await assert.rejects(() => scroll(), /user is controlling/);
  } finally {
    restore();
  }
});

function withFakeEgo(run) {
  const originalEgo = globalThis.ego;
  globalThis.ego = { sendCDPMessage: () => {} };
  return run().finally(() => {
    if (originalEgo === undefined) delete globalThis.ego;
    else globalThis.ego = originalEgo;
  });
}

test("click dispatches native input without a page-side probe when the renderer acknowledges it", async () => {
  const calls = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        // Element resolution (buildSelectorCenterJs) — return center point
        return { result: { value: { x: 100, y: 200 } } };
      }
      return {};
    },
  });
  try {
    await withFakeEgo(() => click("#target"));
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.map((call) =>
      call.method === "Input.dispatchMouseEvent"
        ? `${call.method}:${call.params.type}`
        : call.method,
    ),
    [
      "Runtime.evaluate",
      "Input.dispatchMouseEvent:mouseMoved",
      "Input.dispatchMouseEvent:mousePressed",
      "Input.dispatchMouseEvent:mouseReleased",
    ],
    "a normal click is element resolution plus three native input events",
  );
  assert.equal(
    calls.some((call) =>
      call.params.expression?.includes("__egoBrowserInputProbes"),
    ),
    false,
    "the normal path never installs or reads a click probe",
  );
});

test("click probes for the trusted click and falls back to synthetic events only after a dispatch timeout", async () => {
  const calls = [];
  const probeExpressions = [];
  const restore = setOverrides({
    cdpOverride(method, params) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        if (params.expression?.includes("__egoBrowserInputProbes")) {
          probeExpressions.push(params.expression);
          if (probeExpressions.length === 1) {
            // installClickProbe — elementFromPoint returns truthy
            return { result: { value: true } };
          }
          // finishClickProbe — the trusted click never arrived
          return { result: { value: { seen: false, fallback: true } } };
        }
        return { result: { value: { x: 100, y: 200 } } };
      }
      if (method === "Input.dispatchMouseEvent") {
        // Simulate CDP timeout — the browser couldn't dispatch the event
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    // Should NOT throw — timeout is absorbed because fallback succeeded
    await withFakeEgo(() => click("#target"));
  } finally {
    restore();
  }

  assert.equal(
    probeExpressions.length,
    2,
    "the probe is installed and read once each after the timeout",
  );
  const firstInput = calls.findIndex(
    (call) => call.method === "Input.dispatchMouseEvent",
  );
  const probeInstall = calls.findIndex((call) =>
    call.params.expression?.includes("__egoBrowserInputProbes"),
  );
  assert(
    firstInput >= 0 && probeInstall > firstInput,
    "the probe is installed only after native input timed out",
  );
  assert.match(
    probeExpressions[1],
    /dispatchEvent/,
    "finish expression contains fallback mouse events",
  );
  assert.match(
    probeExpressions[1],
    /MouseEvent/,
    "finish expression dispatches MouseEvent in fallback",
  );
});

test("click rethrows a dispatch timeout when the fallback finds no element", async () => {
  const restore = setOverrides({
    cdpOverride(method, params) {
      if (method === "Runtime.evaluate") {
        if (params.expression?.includes("__egoBrowserInputProbes")) {
          // installClickProbe — nothing under the point
          return { result: { value: false } };
        }
        return { result: { value: { x: 100, y: 200 } } };
      }
      if (method === "Input.dispatchMouseEvent") {
        throw new Error("CDP request timed out: Input.dispatchMouseEvent");
      }
      return {};
    },
  });
  try {
    await assert.rejects(
      () => withFakeEgo(() => click("#target")),
      /CDP request timed out: Input\.dispatchMouseEvent/,
    );
  } finally {
    restore();
  }
});
