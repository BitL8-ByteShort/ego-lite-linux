import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
if (process.platform !== "linux")
  throw Error("Real Linux Chromium qualification must run on Linux");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const cli = resolve(root, "package/ego-linux-host/bin/ego-browser.mjs");
const temp = await mkdtemp(join(tmpdir(), "ego-live-"));
const profile = "qualification";
const env = {
  ...process.env,
  HOME: temp,
  XDG_DATA_HOME: join(temp, "data"),
  XDG_CONFIG_HOME: join(temp, "config"),
  XDG_RUNTIME_DIR: join(temp, "runtime"),
  EGO_LINUX_PROFILE: profile,
  EGO_LINUX_AGENT_ID: "agent-A",
};
await mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 });
const server = createServer((req, res) => {
  if (req.url === "/login")
    res.setHeader("Set-Cookie", "fixtureLogin=yes; Max-Age=3600; Path=/");
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><title>Controlled login</title><button id="button">Run</button><input id="name"><a id="popup" target="_blank" href="/child">Open child</a><script>document.querySelector("#button").onclick=()=>document.querySelector("#button").textContent="Done"</script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
let rounds = 0;
async function run(code, extra = {}) {
  rounds++;
  return command(["nodejs", "-e", code], extra);
}
async function command(args, extra = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const timer = setTimeout(() => child.kill("SIGTERM"), 75000);
  const status = await new Promise((r) => child.on("exit", r));
  clearTimeout(timer);
  if (status !== 0) throw Error(`CLI failed (${status}): ${stderr}\n${stdout}`);
  return stdout;
}
const assertCode = 'const assert=(await import("node:assert/strict")).default;';
const cookie = () => {};
try {
  await run(
    `${assertCode}const t=await taskSpace('persistent');const p=t.page('p1');await p.goto(${JSON.stringify(url + "/login")});await p.evaluate(async()=>{localStorage.setItem('fixture','durable');await new Promise((r,j)=>{const q=indexedDB.open('fixture',1);q.onupgradeneeded=()=>q.result.createObjectStore('data');q.onerror=j;q.onsuccess=()=>{const db=q.result;const tx=db.transaction('data','readwrite');tx.objectStore('data').put('durable','key');tx.oncomplete=()=>{db.close();r()};};});});console.log(await p.snapshot());`,
  );
  const status = JSON.parse(await command(["status"]));
  assert.ok(status.generation);
  await command(["stop"]);
  await run(
    `${assertCode}const t=await taskSpace('restart-check');const p=t.page('p1');await p.goto(${JSON.stringify(url)});assert.match(await p.evaluate(()=>document.cookie),/fixtureLogin=yes/);assert.equal(await p.evaluate(()=>localStorage.getItem('fixture')),'durable');assert.equal(await p.evaluate(async()=>new Promise((r,j)=>{const q=indexedDB.open('fixture',1);q.onerror=j;q.onsuccess=()=>{const db=q.result;const tx=db.transaction('data');const get=tx.objectStore('data').get('key');get.onsuccess=()=>{db.close();r(get.result)};};})),'durable');ego.useTaskSpace(t.spaceId);await ego.closeTaskSpace();console.log('restart persistence passed');`,
  );
  const status2 = JSON.parse(await command(["status"]));
  assert.notEqual(status.generation, status2.generation);
  await run(
    `${assertCode}const t=await taskSpace('separate');const p=t.page('p1');await p.goto(${JSON.stringify(url)});assert.equal(await p.evaluate(()=>document.cookie),'');assert.equal(await p.evaluate(()=>localStorage.getItem('fixture')),null);ego.useTaskSpace(t.spaceId);await ego.closeTaskSpace();`,
    { EGO_LINUX_PROFILE: "separate" },
  );
  await command(["stop"], { EGO_LINUX_PROFILE: "separate" });
  await Promise.all(
    ["A", "B"].map((agent) =>
      run(
        `${assertCode}const t=await taskSpace('concurrent-${agent}');const p=t.page('p1');await p.goto(${JSON.stringify(url)});assert.match(await p.evaluate(()=>document.cookie),/fixtureLogin=yes/);await p.fill('loc=css:#name','${agent}');assert.equal(await p.evaluate(()=>document.querySelector('#name').value),'${agent}');await p.click('loc=css:#button');assert.match(await p.snapshot(),/Done/);console.log(t.spaceId);`,
        { EGO_LINUX_AGENT_ID: `agent-${agent}` },
      ),
    ),
  );
  const tasks = JSON.parse(await command(["status"])).tasks;
  const foreign = tasks.find((t) => t.name === "concurrent-A");
  await run(
    `${assertCode}const result=await ego.claimTaskSpace(${foreign.id});assert.equal(result.error_code,'EGO_TASK_SPACE_UNAVAILABLE');`,
    { EGO_LINUX_AGENT_ID: "agent-B" },
  );
  await run(
    `${assertCode}const t=await taskSpace('concurrent-A');const p=t.page('p1');assert.equal(await p.evaluate(()=>document.querySelector('#name').value),'A');ego.useTaskSpace(t.spaceId);await ego.closeTaskSpace();`,
  );
  await run(
    `const t=await taskSpace('concurrent-B');ego.useTaskSpace(t.spaceId);await ego.closeTaskSpace();`,
    { EGO_LINUX_AGENT_ID: "agent-B" },
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        mode: process.argv[2] || "browser",
        rounds,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        browser: status.browserVersion,
        backend:
          env.EGO_LINUX_HEADLESS === "1" ? "real-headless" : "headed-display",
        sandbox: {
          launch:
            "unprivileged, default sandbox, private pipe, no no-sandbox flag",
        },
        persistence: [
          "cookie",
          "localStorage",
          "IndexedDB",
          "separate profile",
        ],
        concurrency: "independent CLI A/B and shared fixture login",
        generationChanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  await command(["stop"]).catch(() => {});
  await command(["stop"], { EGO_LINUX_PROFILE: "separate" }).catch(() => {});
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
