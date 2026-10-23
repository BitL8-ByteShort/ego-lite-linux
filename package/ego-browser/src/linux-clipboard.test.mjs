import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import {
  __testing,
  withTemporaryClipboardContent,
  withTemporaryClipboardText,
} from "../dist/src/clipboard.js";

const skip =
  process.platform !== "linux" ||
  !process.env.DISPLAY ||
  !!process.env.WAYLAND_DISPLAY
    ? "requires an X11 display, Python3/libX11/libXfixes and xclip (run under Xvfb for fixture qualification)"
    : false;
const nativeTest = (name, fn) => test(name, { skip }, fn);
const copy = (text, target = "UTF8_STRING") =>
  execFileSync("xclip", ["-selection", "clipboard", "-target", target], {
    input: text,
    stdio: ["pipe", "ignore", "ignore"],
  });
const read = (target = "UTF8_STRING") =>
  execFileSync(
    "xclip",
    ["-selection", "clipboard", "-out", "-target", target],
    { timeout: 3000 },
  ).toString();

nativeTest(
  "X11 restores Unicode from a native owner without TIMESTAMP support",
  async () => {
    const saved = "original 世界 🙂\n";
    copy(saved);
    await withTemporaryClipboardText("temporary 世界 🙂", async () => {
      assert.equal(read(), "temporary 世界 🙂");
    });
    assert.equal(read(), saved);
  },
);

nativeTest(
  "X11 offers both plain and HTML and restores original native HTML bytes",
  async () => {
    const saved = "<b>original 世界</b>";
    copy(saved, "text/html");
    await withTemporaryClipboardContent(
      { text: "A\tB", html: "<table><tr><td>A</td><td>B</td></tr></table>" },
      async () => {
        assert.equal(read(), "A\tB");
        assert.equal(
          read("text/html"),
          "<table><tr><td>A</td><td>B</td></tr></table>",
        );
      },
    );
    assert.equal(read("text/html"), saved);
  },
);

nativeTest(
  "X11 respects a user replacement even when the bytes equal the temporary value",
  async () => {
    copy("original");
    const transaction =
      await __testing.beginLinuxClipboardTransaction("same bytes");
    copy("same bytes");
    assert.equal(await transaction.finish(), "changed");
    assert.equal(read(), "same bytes");
  },
);

nativeTest(
  "X11 refuses resource-backed targets before changing native data",
  async () => {
    copy("resource fixture", "PIXMAP");
    await assert.rejects(
      () => __testing.beginLinuxClipboardTransaction("temporary"),
      (error) => error.code === "EGO_CLIPBOARD_UNSAFE_FORMAT",
    );
    assert.equal(read("PIXMAP"), "resource fixture");
  },
);

nativeTest(
  "X11 preserves binary image bytes and restores after an action error",
  async () => {
    const saved = Buffer.from([0x89, 0x50, 0, 0xff, 0x01]);
    copy(saved, "image/png");
    const actionError = new Error("fixture action failed");
    await assert.rejects(
      () =>
        withTemporaryClipboardText("temporary", async () => {
          throw actionError;
        }),
      (error) => error === actionError,
    );
    const actual = execFileSync(
      "xclip",
      ["-selection", "clipboard", "-out", "-target", "image/png"],
      { timeout: 3000 },
    );
    assert.deepEqual(actual, saved);
  },
);

nativeTest(
  "X11 refuses an oversized incoming offer before changing the original clipboard",
  async () => {
    copy("original small clipboard");
    await assert.rejects(
      () => __testing.beginLinuxClipboardTransaction("x".repeat(1024 * 1024)),
      (error) => error.code === "EGO_CLIPBOARD_UNSAFE_FORMAT",
    );
    assert.equal(read(), "original small clipboard");
  },
);

nativeTest(
  "X11 serializes clipboard transactions from independent Node processes",
  async () => {
    copy("original");
    const source = `
    import { withTemporaryClipboardText } from ${JSON.stringify(new URL("../dist/src/clipboard.js", import.meta.url).href)};
    await withTemporaryClipboardText(process.argv[1], async () => {
      console.log("ready");
      await new Promise(resolve => process.stdin.once("data", resolve));
    });
  `;
    const start = (name, env = process.env) => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", source, name],
        { stdio: ["pipe", "pipe", "pipe"], env },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const lines = createInterface({ input: child.stdout });
      const ready = once(lines, "line");
      const done = once(child, "exit").then(([code]) =>
        assert.equal(code, 0, stderr),
      );
      done.catch(() => {});
      return { child, ready, done };
    };
    const first = start("first");
    let second;
    try {
      await first.ready;
      second = start("second", {
        ...process.env,
        DISPLAY: process.env.DISPLAY.replace(/\.\d+$/, "") + ".0",
      });
      let secondStarted = false;
      second.ready.then(() => {
        secondStarted = true;
      });
      await sleep(100);
      assert.equal(secondStarted, false);
      assert.equal(read(), "first");
      first.child.stdin.end("finish");
      await first.done;
      await second.ready;
      assert.equal(read(), "second");
      second.child.stdin.end("finish");
      await second.done;
      assert.equal(read(), "original");
    } finally {
      first.child.kill();
      second?.child.kill();
    }
  },
);
