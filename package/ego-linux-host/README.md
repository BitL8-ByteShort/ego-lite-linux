# ego lite community Linux host

This additive host loads the original ego-browser SDK around an owned stock Chromium process. It retains the complete upstream repository, MIT license, SDK, site learnings and agent adapters. It does not contain the proprietary Citro browser application.

Requires Linux, Node.js 22+, util-linux `flock`, and sandbox-capable Chrome/Chromium. The browser runs as an unprivileged user with a dedicated persistent named profile and a private DevTools pipe. Never use `--no-sandbox`. Ubuntu/Debian x86_64 is the initial target; current local browser receipts are Debian 12 ARM64 in Docker. Native desktop qualification is recorded separately.

```bash
npm ci --prefix package/ego-browser
npm run build --prefix package/ego-browser
npm ci --prefix package/ego-linux-host
npm run build --prefix package/ego-linux-host
node package/ego-linux-host/bin/ego-lite.mjs --profile default
```

The launcher opens personal browsing and an authenticated Spaces window. Sign in normally in personal browsing. Sign-ins survive browser and daemon restarts. Tasks in the same named profile deliberately share cookies, storage and website actions; their isolation is tab/command ownership. Use another `--profile work` for separate accounts.

The host disables Chromium's `PdfGetSaveDataInBlocks` feature so original-document PDF saves use the download events observed by the SDK. Chrome field trials can otherwise select a native file-writer path that bypasses those events. The PDF viewer and annotation tools remain enabled; see the [Chromium feature definition](https://chromium.googlesource.com/chromium/src/+/main/pdf/pdf_features.cc) and the live verification report.

Spaces supports creating/opening profiles, personal browsing, creating a task and explicitly granting it to an agent identity, reveal, hard pause/take control, resume, close and browser shutdown. Restored or unknown tabs remain in your inbox until you explicitly assign them. Refreshing the controller retains its private tab session. Wayland activation remains subject to compositor policy.

Each agent workflow retains one random non-secret identity for its lifetime:

```bash
export EGO_LINUX_AGENT_ID="$(node -e 'console.log(crypto.randomUUID())')"
node package/ego-linux-host/bin/ego-browser.mjs skill
node package/ego-linux-host/bin/ego-browser.mjs nodejs <<'JS'
const task = await taskSpace('research');
const page = task.page('p1');
await page.goto('https://example.com');
console.log(await page.snapshot());
JS
```

Retain that identity across shell rounds. The explicit `interactive` default is for manual CLI use; diagnostics report its source. Another workflow identity cannot silently claim your task. A hard user pause cannot be cleared by an agent. A command already sent to a website can have completed before a pause; the controller acknowledgment reports this limit.

Supported CLI forms: bare stdin, `nodejs` stdin, `nodejs -e CODE`, `nodejs FILE`, `nodejs --sdk-path /absolute/index.js`, `skill`, `--help`, `doctor --json`, `status`, `stop`, and `open`. `--profile ID`, `EGO_LINUX_PROFILE`, `--agent-id ID`, and `EGO_LINUX_AGENT_ID` select profile/workflow identity. `skill` and help do not launch a browser. A selected CLI profile exposes its own native profile descriptor; use a separate invocation with `--profile` for a different identity. A supplied native `globalThis.ego` takes precedence.

Default mode is headed. Set `EGO_LINUX_HEADLESS=1` explicitly for automated fixtures; visual reveal/handoff rejects in headless mode. Set `EGO_LINUX_CHROME_PATH` to an executable if browser discovery needs an override. `doctor` reports configured and probed states separately and never labels a configuration-only check a sandbox qualification.

State: `$XDG_DATA_HOME/ego-lite-linux/profiles/ID` (fallback `~/.local/share`), configuration under `$XDG_CONFIG_HOME/ego-lite-linux`, and private runtime locks/sockets under `$XDG_RUNTIME_DIR` or an owner-only `/tmp` fallback. Kernel file locks enforce one daemon per profile and release after a crash. Logical task metadata persists; renderer refs, capabilities and sessions never survive a browser generation. Restarted tasks default to human pause and restored tabs remain unclaimed.

Snapshots cover frame topology, AX/DOM, shadow DOM, scoped capture and stable refs through the upstream SDK. Stock Chromium cannot reproduce proprietary engine anti-detection behavior. Linux's `egoAutomated` compatibility hooks filter console delivery; they do not establish equivalent anti-detection guarantees. X11 rich clipboard supports safe format preservation with Python3/libX11/libXfixes. Unsupported formats and native Wayland clipboard fail before mutation; plain text insertion remains independent.

Installation and artifacts: [installation.md](../../docs/linux/installation.md). Current qualification and limitations: [VERIFICATION.md](../../docs/linux/VERIFICATION.md). The archive includes host, SDK, matching guides, skills, learnings, installer, uninstaller and notices. Updates/uninstall preserve profiles. Task download waiters temporarily allow automatic saving in the profile’s normal Downloads directory, then restore normal behavior. Because tasks share a Chromium profile, a personal Save As started during that brief interval can save automatically; filenames and the configured destination are retained.

```bash
npm test --prefix package/ego-linux-host
npm run typecheck --prefix package/ego-linux-host
npm run style:check --prefix package/ego-linux-host
npm run test:browser --prefix package/ego-linux-host
npm run test:persistence --prefix package/ego-linux-host
npm run test:concurrency --prefix package/ego-linux-host
npm run test:lifecycle --prefix package/ego-linux-host
xvfb-run -a env EGO_LINUX_HEADLESS=0 npm run test:control --prefix package/ego-linux-host
npm run test:install --prefix package/ego-linux-host
```

Xvfb and containers are synthetic test environments; they do not qualify native X11/Wayland focus, clipboard integration, desktop accessibility or compositor behavior.
