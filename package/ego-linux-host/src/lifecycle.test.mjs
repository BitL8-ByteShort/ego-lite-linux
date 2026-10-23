import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CdpBridge } from "../dist/src/cdp-bridge.js";
import { chromeArguments } from "../dist/src/chrome-supervisor.js";
test("pipe CDP translates identical client requests into distinct transport IDs", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const bridge = new CdpBridge(input, output);
  const sent = [];
  input.on("data", (b) => sent.push(JSON.parse(b.toString().slice(0, -1))));
  const a = bridge.call("Browser.getVersion"),
    b = bridge.call("Browser.getVersion");
  assert.notEqual(sent[0].id, sent[1].id);
  output.write(JSON.stringify({ id: sent[1].id, result: { v: "B" } }) + "\0");
  output.write(JSON.stringify({ id: sent[0].id, result: { v: "A" } }) + "\0");
  assert.deepEqual(await Promise.all([a, b]), [{ v: "A" }, { v: "B" }]);
  bridge.close();
});
test("pending calls reject on EOF and launch arguments retain sandbox with dedicated persistent profile", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const bridge = new CdpBridge(input, output);
  const p = bridge.call("Browser.getVersion");
  output.end();
  await assert.rejects(p, /closed/);
  const args = chromeArguments("/private/profile", true);
  assert.ok(args.includes("--remote-debugging-pipe"));
  assert.ok(args.includes("--user-data-dir=/private/profile"));
  assert.ok(
    !args.some(
      (x) => x.includes("no-sandbox") || x.includes("remote-debugging-port"),
    ),
  );
});
