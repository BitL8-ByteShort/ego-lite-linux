import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bufferOutput,
  flushSink,
  installLifecycleFlush,
  markHardStop,
  resetSink,
} from "../dist/src/output-sink.js";
import {
  markPageObserved,
  recordUnhandledPage,
} from "../dist/src/page-discovery.js";
import {
  recordAgentControlledSpace,
  releaseAgentControlledSpace,
} from "../dist/src/agent-control-notice.js";

test("lifecycle flush writes synchronously when stdout exposes an fd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ego-output-sink-test-"));
  const path = join(directory, "stdout.txt");
  const file = await open(path, "w");
  const lifecycle = new EventEmitter();
  try {
    resetSink();
    bufferOutput("tail output\n");
    installLifecycleFlush(
      {
        fd: file.fd,
        write() {
          throw new Error("asynchronous write should not be used");
        },
      },
      lifecycle,
    );

    lifecycle.emit("exit");
    await file.sync();
    assert.equal(await readFile(path, "utf8"), "tail output\n");
  } finally {
    await file.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function fakeStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
    },
    text() {
      return chunks.join("");
    },
  };
}

test("flushSink writes buffered output verbatim on a clean run", () => {
  resetSink();
  bufferOutput("a\n");
  bufferOutput("b\n");
  const out = fakeStream();
  flushSink(out, false);
  assert.equal(out.text(), "a\nb\n");
});

test("a swallowed hard stop discards the buffer and prints the owned message once", () => {
  resetSink();
  bufferOutput("visiting\n");
  markHardStop("HARD STOP MESSAGE");
  markHardStop("a later re-report that must be ignored");
  const out = fakeStream();
  flushSink(out, false);
  assert.equal(out.text(), "HARD STOP MESSAGE\n");
});

test("a thrown hard stop stays silent so the propagating error is not echoed twice", () => {
  resetSink();
  bufferOutput("visiting\n");
  markHardStop("HARD STOP MESSAGE");
  const out = fakeStream();
  flushSink(out, true);
  assert.equal(out.text(), "");
});

test("an ordinary thrown error still flushes what was logged before it", () => {
  resetSink();
  bufferOutput("partial\n");
  const out = fakeStream();
  flushSink(out, true);
  assert.equal(out.text(), "partial\n");
});

test("flushSink runs at most once", () => {
  resetSink();
  bufferOutput("x\n");
  const out = fakeStream();
  flushSink(out, false);
  flushSink(out, false);
  assert.equal(out.text(), "x\n");
});

test("a message that already ends in a newline is not double-terminated", () => {
  resetSink();
  markHardStop("already terminated\n");
  const out = fakeStream();
  flushSink(out, false);
  assert.equal(out.text(), "already terminated\n");
});

test("flushSink appends unhandled pages after the script output", () => {
  resetSink();
  bufferOutput("saved rows\n");
  recordUnhandledPage({
    spaceId: 7,
    targetId: "target-popup",
    label: "p4",
    openerLabel: "p1",
    url: "https://example.test/popup",
  });
  const out = fakeStream();

  flushSink(out, false);

  assert.equal(
    out.text(),
    "saved rows\n[ego-browser:pages]\nUnhandled page p4 from p1: https://example.test/popup\n",
  );
});

test("using a discovered Page suppresses its round-end notice", () => {
  resetSink();
  recordUnhandledPage({
    spaceId: 7,
    targetId: "target-popup",
    label: "p4",
    url: "about:blank",
  });
  markPageObserved(7, "target-popup");
  const out = fakeStream();

  flushSink(out, false);

  assert.equal(out.text(), "");
});

test("a hard stop discards unhandled-page notices with other output", () => {
  resetSink();
  recordUnhandledPage({
    spaceId: 7,
    targetId: "target-popup",
    label: "p4",
    url: "about:blank",
  });
  markHardStop("STOP");
  const out = fakeStream();

  flushSink(out, false);

  assert.equal(out.text(), "STOP\n");
});

test("flushSink reminds the Agent about spaces it still controls", () => {
  resetSink();
  bufferOutput("done\n");
  recordUnhandledPage({
    spaceId: 7,
    targetId: "target-popup",
    label: "p4",
    url: "about:blank",
  });
  recordAgentControlledSpace(9);
  recordAgentControlledSpace(7);
  recordAgentControlledSpace(8);
  releaseAgentControlledSpace(8);
  const out = fakeStream();

  flushSink(out, false);

  const [output, pages, page, notice, rest] = out.text().split("\n");
  assert.deepEqual(
    [output, pages, page, rest],
    ["done", "[ego-browser:pages]", "Unhandled page p4: about:blank", ""],
  );
  assert.match(notice, /^\[ego-browser:task\] .* task spaces 7, 9,/);
  assert.match(notice, /task\.finish\(\{ keep \}\).*task\.handOff\(\)/);
});

test("a failed round still reminds the Agent to release control", () => {
  resetSink();
  recordAgentControlledSpace(7);
  const out = fakeStream();

  flushSink(out, true);

  assert.match(out.text(), /^\[ego-browser:task\] .* task space 7,/);
});

test("a hard stop drops the Agent-control reminder", () => {
  resetSink();
  recordAgentControlledSpace(7);
  markHardStop("STOP");
  const out = fakeStream();

  flushSink(out, false);

  assert.equal(out.text(), "STOP\n");
});
