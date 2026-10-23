import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FrameDecoder,
  encodeFrame,
  REQUEST_LIMIT,
  RESPONSE_LIMIT,
} from "../dist/src/transport.js";
import { resolvePaths, privateDirectory } from "../dist/src/paths.js";
import { TaskRegistry } from "../dist/src/task-registry.js";
test("frames preserve split large responses and coalesced messages", () => {
  const data = { id: 1, result: "ü".repeat(700000) };
  const encoded = encodeFrame(data, RESPONSE_LIMIT);
  const decoder = new FrameDecoder(RESPONSE_LIMIT);
  const out = [];
  for (let i = 0; i < encoded.length; i += 7919)
    out.push(...decoder.push(encoded.subarray(i, i + 7919)));
  assert.deepEqual(out, [data]);
  assert.deepEqual(
    decoder.push(
      Buffer.concat([encodeFrame({ id: 2 }), encodeFrame({ id: 3 })]),
    ),
    [{ id: 2 }, { id: 3 }],
  );
});
test("request/response declared limits and malformed JSON fail before accepting payload", () => {
  for (const limit of [REQUEST_LIMIT, RESPONSE_LIMIT]) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(limit + 1);
    assert.throws(() => new FrameDecoder(limit).push(header), /large/);
  }
  assert.throws(
    () => new FrameDecoder(REQUEST_LIMIT).push(Buffer.from([0, 0, 0, 1, 123])),
    /JSON/,
  );
});
test("private paths reject symlink and public directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ego-path-"));
  try {
    const paths = resolvePaths(
      { HOME: root },
      process.getuid?.() ?? 0,
      "default",
    );
    assert.ok(paths.dataDir.startsWith(root));
    await privateDirectory(paths.dataDir);
    const link = join(root, "link");
    await symlink(paths.dataDir, link);
    await assert.rejects(privateDirectory(link), /private/);
    const pub = join(root, "pub");
    await mkdir(pub);
    await chmod(pub, 0o755);
    await assert.rejects(privateDirectory(pub), /private/);
    assert.ok(Buffer.byteLength(paths.socketPath) < 104);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("stable owner resumes while foreign agents, stale epochs and hard pause cannot acquire", () => {
  const registry = new TaskRegistry("generation");
  const task = registry.create("demo", "default", "A");
  const lease = registry.acquire(task.id, "A", "one");
  assert.equal(registry.assert(lease).id, task.id);
  assert.throws(() => registry.acquire(task.id, "B", "two"), /owner/);
  assert.throws(() => registry.acquire(task.id, "A", "two"), /lease/);
  registry.disconnect("one");
  const second = registry.acquire(task.id, "A", "two");
  registry.revoke(task.id, "user-pause");
  assert.throws(() => registry.assert(second), {
    error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
  });
  assert.throws(() => registry.takeOver(task.id, "A"), /paused/);
  registry.resume(task.id);
  assert.equal(registry.acquire(task.id, "A", "two").taskId, task.id);
});
test("explicit claim/takeover rotates existing capability instead of returning a stale epoch", () => {
  const r = new TaskRegistry("g"),
    t = r.create("claim", "default", "A");
  const first = r.acquire(t.id, "A", "client");
  r.takeOver(t.id, "A", true);
  const second = r.acquire(t.id, "A", "client");
  assert.notEqual(second.capability, first.capability);
  assert.equal(r.assert(second).id, t.id);
  assert.throws(() => r.assert(first));
});
test("delegation preserves agent-owned identity so SDK records a user boundary", () => {
  const r = new TaskRegistry("g"),
    t = r.create("handoff", "default", "A");
  r.revoke(t.id, "handoff");
  assert.equal(r.get(t.id).ownership, "agentDelegatedToUser");
  r.takeOver(t.id, "A");
  assert.equal(r.get(t.id).ownership, "agent");
});
test("human-created spaces need an explicit owner grant; granted workflow acquires normally", () => {
  const r = new TaskRegistry("g"),
    t = r.createUser("manual", "default");
  assert.equal(t.createdBy, "user");
  assert.equal(t.ownership, "user");
  assert.throws(() => r.acquire(t.id, "random-workflow", "c"));
  r.grant(t.id, "random-workflow");
  assert.equal(
    r.assert(r.acquire(t.id, "random-workflow", "c")).agentId,
    "random-workflow",
  );
  assert.throws(() => r.acquire(t.id, "foreign", "b"));
});
