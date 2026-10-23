import test from "node:test";
import assert from "node:assert/strict";
import { assertMethod, validateEmbedded } from "../dist/src/cdp-policy.js";
import { TaskRegistry } from "../dist/src/task-registry.js";
test("policy rejects global writes, nested transports and embedded foreign target/session/context IDs", () => {
  for (const m of [
    "Browser.close",
    "Network.clearBrowserCookies",
    "Target.sendMessageToTarget",
    "Page.crash",
  ])
    assert.throws(() => assertMethod(m));
  assertMethod("Runtime.evaluate");
  for (const p of [
    { targetId: "foreign" },
    { nested: { sessionId: "foreign" } },
    { browserContextId: "same" },
    { message: "{}" },
  ])
    assert.throws(() =>
      validateEmbedded(
        p,
        () => {
          throw Error("foreign");
        },
        () => {
          throw Error("foreign");
        },
      ),
    );
});
test("owned-session policy permits viewport metrics without general emulation authority", () => {
  assert.doesNotThrow(() => assertMethod("Emulation.setDeviceMetricsOverride"));
  assert.doesNotThrow(() =>
    assertMethod("Emulation.clearDeviceMetricsOverride"),
  );
  assert.throws(() => assertMethod("Emulation.setLocaleOverride"));
  assert.throws(() => assertMethod("Page.bringToFront"));
});
test("browser generation invalidates capability and task crash restoration defaults to hard user pause", () => {
  const r = new TaskRegistry("one"),
    t = r.create("task", "default", "A"),
    l = r.acquire(t.id, "A", "client");
  const restarted = new TaskRegistry("two", [t]);
  assert.throws(() => restarted.assert(l));
  assert.throws(() => restarted.takeOver(t.id, "A"));
  assert.equal(restarted.get(t.id).ownership, "user");
});
