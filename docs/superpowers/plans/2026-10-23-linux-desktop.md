# ego lite Linux Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the requested single Sol run. Steps use checkboxes for tracking. Use focused review delegates where helpful; the primary executor owns integration and completion. Chris has already selected the execution approach; do not ask him to select it again.

**Goal:** Deliver an installable Linux browser experience with persistent shared sign-ins, concurrent agent task tabs, human control, and the complete upstream ego SDK/skill/plugin workflow.

**Architecture:** Add `package/ego-linux-host/` around the upstream SDK's native `globalThis.ego` boundary. A private daemon owns sandboxed Chromium per named persistent profile, routes task-scoped CDP, and serves a small authenticated local Spaces controller. Reuse attributed PR transport/lifecycle ideas without importing their incompatible persistence/ownership models.

**Tech Stack:** Node 22+, TypeScript ESM, Node built-ins, upstream esbuild tooling, stock Chrome/Chromium/CDP, static HTML/CSS/JS, user-level Linux desktop integration.

**Spec:** `docs/superpowers/specs/2026-10-23-linux-desktop-design.md`.

## Global Constraints

- Base: upstream `dev` commit `c024c32aa9fb2b4f7ff0524e38e8984bc982db53`; working branch `feat/linux-desktop`.
- Runtime: Node.js **22 or later**, ESM TypeScript, `.js` import extensions, Node's built-in test runner.
- Preserve upstream v2 `TaskSpace`/`Page`, frozen v1 compatibility helpers, public schema/help, site learnings and every plugin adapter.
- The Linux host is additive. Existing native `globalThis.ego` wins; imports and help on macOS/Windows must never launch the Linux host.
- Browser: owned Chrome/Chromium process, sandbox enabled, private DevTools pipe, dedicated user-data directory. No auto-attachment to an unrelated debugging port or live personal browser profile.
- Persistent profile data lives under `$XDG_DATA_HOME/ego-lite-linux` (fallback `~/.local/share/ego-lite-linux`); configuration under `$XDG_CONFIG_HOME/ego-lite-linux`; runtime sockets/locks under a validated private `$XDG_RUNTIME_DIR/ego-lite-linux` or a short, owner-only fallback. Data directories `0700`, private state files and sockets `0600`.
- First supported distribution: Ubuntu 24.04+ / Debian-family Linux x86_64 with an available sandbox-capable Chrome/Chromium. X11 and Wayland are separate validation targets. Other distros and ARM64 are best-effort until tested; detect and report rather than advertise unverified support.
- Shared-profile task separation is **operational tab/command ownership**, not isolation of cookies, account data, same-origin storage, service workers or website actions. Named profiles provide account separation.
- No credentials, personal cookies, authorization tokens or private browsing data in Git, logs, fixtures or acceptance artifacts.
- Full native Citro browser source is unavailable. Implement the selected Linux host and desktop experience; preserve the open project and describe community-build identity accurately.

## Review Focus

1. An SDK/host upgrade or changed display configuration must retain the same profile and sign-ins; a new browser generation invalidates stale refs instead of selecting an unrelated page. Tests: Tasks 2, 4 and 5.
2. Two agents can use identical numeric CDP request IDs and identical task names without receiving each other's replies, popup events or authority. Tests: Tasks 1 and 3.
3. A human pauses a task during a dialog, Fetch interception or long wait: the controller remains responsive, queued actions are rejected and paused browser work is released. Tests: Tasks 3 and 6.
4. The packaged browser runs after the checkout is moved/deleted, under a path containing spaces, and an upgrade/uninstall leaves profile data intact. Tests: Task 7.
5. A Wayland test that actually used XWayland, a fake Chrome adapter, or a selected/skipped E2E subset must not satisfy live desktop completion. Tests and evidence checks: Tasks 8 and 9.

## Execution rules and current scaffold

The fork, working branch, minimal host manifest, document set, model defaults and launch script already exist. Baseline upstream SDK tests passed 586/586 and plugin tests 37/37 on macOS; see `docs/linux/PROGRESS.md`. Those results establish a clean starting SDK, not Linux functionality.

Perform the work below in sequence. Commit meaningful verified units. Keep `docs/linux/PROGRESS.md` current so compaction or interruption can resume without repeating finished work. Fix routine integration/test failures autonomously. Do not finish after a build, smoke test, or first milestone while authorized implementation remains.

Read `docs/linux/UPSTREAM-AUDIT.md` before copying proposal code. Do not wholesale merge either PR. Record adapted filenames and original authors/commits in `docs/linux/ATTRIBUTION.md`.

Use the existing source checkout; the user requested this project directory. If work is executed elsewhere on Linux, clone the fork at the same branch/commit, keep that as the execution checkout, and return tested commits/artifact receipts to this project. Never pretend a Mac browser run is Linux verification.

Build-mutating commands in `package/ego-browser` must run sequentially: `build`, `test`, `validate:site-skills`, and `e2e` each replace `dist/`. Independent inspection/review may run concurrently.

---

## Task 1: Establish the host package, native contract and local protocol

**Files:** Extend `package/ego-linux-host/package.json` and README; create `package-lock.json`, `tsconfig.json`, `scripts/build.mjs`, `src/protocol.ts`, `src/errors.ts`, `src/paths.ts`, `src/transport.ts` and colocated `*.test.mjs`; add `docs/linux/ATTRIBUTION.md`.

**Interfaces:** Define and export `ProfileId = string`, `TaskId = number`, `BrowserGeneration = string`; `RpcRequest = {version:1,id:number,method:string,args:unknown[],context?:{clientId:string,agentId:string,taskId:TaskId,capability:string,epoch:number,generation:BrowserGeneration}}`; `RpcResponse = {id:number,result?:unknown,error?:{message:string,error_code:string}}`; task events carry the same task/generation/epoch context. `resolvePaths(env:NodeJS.ProcessEnv, uid:number):HostPaths` returns validated config/data/runtime locations. `HostPaths` contains `configDir`, `dataDir`, `runtimeDir` and `socketPath`. Use length-prefixed frames with a maximum encoded request body of 1 MiB and response/event body of 32 MiB. Reject an oversized declared length before allocating its body. Apply the corresponding directional bound to both incomplete and complete frames; a valid response must remain valid when split across reads. Test both limits and connection teardown.

- [ ] Read upstream `AGENTS.md`, native binding and snapshot requirement documents. Build a contract matrix mapping every native method/result/error to its host implementation and test. Include sync `useTaskSpace`, profile listing, optional UI hooks, completion checks, event callbacks and lifecycle disposal.
- [ ] Add failing Node tests for protocol version mismatch; split/coalesced frames, including a valid response over 1 MiB split across many reads; reused client request IDs; oversized declared request/response lengths; malformed JSON; EOF with pending calls; private XDG fallback, Unix socket path limits, symlink/unowned-directory rejection. Assert replies return only to the originating connection.
- [ ] Implement package build/test/typecheck/style scripts following upstream patterns, then implement transport/types/error helpers and paths. Keep platform-independent transport tests runnable on Mac/Windows; gate real Unix/Linux cases explicitly.
- [ ] Run `npm ci --prefix package/ego-linux-host`, `npm test --prefix package/ego-linux-host`, and `npm run typecheck --prefix package/ego-linux-host`. Expected: all added contract tests pass, with explicit platform-only skips where unavoidable and no fake successful operations.
- [ ] Record reuse provenance and commit `feat(linux): establish host contracts and private transport`.

## Task 2: Own persistent Chromium profiles and recover the host lifecycle

**Files:** Create `src/{profiles,chrome-supervisor,cdp-bridge,host-control,host-daemon}.ts` with colocated tests; `scripts/persistence-e2e.mjs`; extend paths/protocol. Start from #291 pipe framing and #202 atomic persistence/lifecycle ideas.

**Interfaces:** `loadProfile(id:ProfileId):Promise<ProfileRecord>`; `launchChrome(profile:ProfileRecord, options:{headless:boolean}):Promise<ChromeInstance>`; `ChromeInstance = {generation:BrowserGeneration,cdp:CdpTransport,headless:boolean,close():Promise<void>}`; `CdpTransport.call(method:string,params?:Record<string,unknown>,sessionId?:string,timeoutMs?:number):Promise<any>` plus event subscription/disposal; `ensureHost(profileId:ProfileId):Promise<HostConnection>`; `stopHost(profileId:ProfileId):Promise<void>`. Define serializable profile records with stable IDs, display names and managed directory names; keep executable/configuration separate from durable identity.

- [ ] Add failing tests for two simultaneous startups (one browser owner), profile lock conflict, stale socket, reused live PID, process exit during startup, invalid executable, timeout, graceful stop, browser crash, host crash and upgrade. Assert only the recorded owned process can be signalled; assert persistent directories are never removed by shutdown.
- [ ] Adapt the private `--remote-debugging-pipe` transport. Resolve Chrome/Chromium without shell interpolation; keep the browser sandbox on and provide a useful failure if it cannot start. Never attach to 9222. Enforce one owned process per profile and version the protocol independently of profile paths.
- [ ] Implement atomic state replacement, restrictive permissions, graceful browser shutdown with bounded owned-process fallback, generation changes and recoverable errors. Separate browser lifecycle from any individual CLI round.
- [ ] Create a local fixture that writes a cookie, localStorage and IndexedDB, stops the entire browser/daemon, starts it again and verifies all three. Repeat after changing the SDK/host build identity. Test a separate named profile has independent values. Do not use personal browser data.
- [ ] Run host tests plus `npm run test:persistence --prefix package/ego-linux-host` on actual Linux with sandboxed Chromium. Expected: durable values survive real process restart; no unrelated browser is touched. Save runtime/version receipts.
- [ ] Commit `feat(linux): persist owned Chromium profiles across restarts`.

## Task 3: Implement task ownership, leases and scoped CDP routing

**Files:** Create `src/{task-registry,leases,target-registry,cdp-policy,session-router}.ts`, their tests, and `scripts/concurrency-e2e.mjs`; extend daemon/protocol.

**Interfaces:** `TaskRegistry.create(name:string,profileId:ProfileId,agentId:string):Promise<TaskRecord>`; `acquireTask(taskId:TaskId,agentId:string,clientId:string):Promise<TaskLease>`; `TaskLease = {taskId,agentId,clientId,capability,epoch,generation}`; `assertLease(lease:TaskLease):TaskRecord`; `revokeTask(taskId:TaskId,reason:'handoff'|'user-pause'|'complete'|'close'):Promise<void>`; `authorizeCdp(lease:TaskLease,message:{method:string,params?:Record<string,unknown>,sessionId?:string}):Promise<AuthorizedCommand>`. The authorized command binds the verified target/session and never retains caller-supplied unchecked transport IDs.

- [ ] Write adversarial behavior tests before implementation: agents A/B issue the same request ID and race task selection; B requests A's task/session/target/download; a target ID appears inside parameters; popup has owned/unknown opener; an OOPIF replaces its renderer; event arrives after revocation; a user/controller tab shares the same default browser context. Assert no unauthorized operation/event succeeds.
- [ ] Implement shared-profile task tab sets and capabilities bound to stable agent identity. Keep task selection local to each adapter and capture context per request. Task IDs/names are not authorization. Enforce one mutation lease per task with concurrency across different tasks.
- [ ] Inventory CDP methods actually used by the SDK, including dynamic driver paths, and implement a method/parameter policy. Mediate browser-level requests, discovery, auto-attach, downloads and child sessions. Deny broad browser operations and unsafe nested transport. Do not use domain wildcards or `browserContextId` to authorize shared-profile tasks.
- [ ] Implement epoch revocation and independent human control priority. A long CDP request or dialog in A must not block B or Pause all. Release owned debugger/Fetch pauses and reject queued mutations after pause acknowledgment. Explicit hard user pause cannot be cleared by agent takeover.
- [ ] Persist only logical task metadata. On generation change invalidate capabilities/sessions/refs, surface prior tasks in a safe state, and leave unproven restored tabs user-owned. Do not authorize by URL/title matching.
- [ ] Run `npm test --prefix package/ego-linux-host` and `npm run test:concurrency --prefix package/ego-linux-host`. The real fixture must show A/B share a controlled login in one profile yet cannot operate or receive events from each other's task tabs. Repeat across independent Node CLI processes, popups, dialogs and task revocation.
- [ ] Commit `feat(linux): isolate task commands and support human revocation`.

## Task 4: Load the unchanged SDK through a complete Linux CLI/native adapter

**Files:** Create `src/{cli,ego-client,sdk-loader}.ts`, `bin/ego-browser.mjs`, `bin/ego-lite.mjs`, contract/CLI tests. Modify upstream files only for demonstrated integration needs, with tests. Keep `package/ego-browser/src/index.ts`, `run.ts`, `public-api-schema.ts`, Page model/ledger and native gate as the contract references.

**Interfaces:** `createEgoAdapter(connection:HostConnection,agentId:string):EgoBindings` implementing `docs/native-bindings-api.md`; `loadSdk(bundlePath:string,ego:EgoBindings):Promise<{runMain:typeof import('../../ego-browser/src/run.js').runMain,disposeEgoSdk:()=>Promise<void>}>` (use a local structural type if cross-package type imports complicate the build); `runCli(argv:string[],io:CliIo):Promise<number>`; `resolveSdkPayload(override?:string):{bundle:string,guideDir:string,entrySkillDir:string}`.

- [ ] Add failing CLI tests for bare stdin; `nodejs` stdin; `nodejs -e`; `.mjs` files; `nodejs --sdk-path` with paths containing spaces; `skill` from the matching payload; help; unknown args; invalid/missing bundle; script errors once; nonzero status; cleanup on exit. Assert help/skill do not launch Chrome.
- [ ] Preserve native synchronous `useTaskSpace` and documented method/error shapes. Bind `sendCDPMessage`, `onCDPMessage`, `onSendCDPMessageError`, profiles, task lifecycle and snapshots without changing public helper signatures.
- [ ] Resolve configuration before adapter activation; install the adapter before dynamic SDK import; call exported `runMain` with the script inputs rather than reimplementing helper execution. Dispose SDK callbacks and client connections without stopping the daemon after each round.
- [ ] Namespace `EGO_BROWSER_STATE_DIR` and Page ledger storage by profile/browser generation. Preserve refs across CLI rounds within one generation; fail stale refs after restart. Implement explicit `--agent-id`/`EGO_LINUX_AGENT_ID` ownership and document how the agent retains it across rounds.
- [ ] Test native Mac/Windows adapter precedence using existing FakeEgo tests: importing SDK or reading help never starts Linux or replaces supplied bindings. Native modes retain current guides, CLI behavior and errors.
- [ ] Run host tests, then upstream `npm test --prefix package/ego-browser`, then `npm test --prefix plugins/ego`. Expected: all original tests remain passing plus added adapter tests. At this milestone, use a limited CLI/transport integration fixture to exercise the actual `nodejs --sdk-path` invocation, stdin execution, task creation and a scoped CDP call. Snapshot-dependent behavior is completed in Task 5; do not treat a limited fixture as full E2E qualification. Run the full upstream E2E suite after Task 5 with `EGO_BROWSER_REAL_E2E_CLI` pointing to the Linux launcher and without suppressing `--sdk-path`.
- [ ] Commit `feat(linux): run upstream SDK through native-compatible launcher`.

## Task 5: Complete frame-aware snapshots and the browser feature contract

**Files:** Create `src/snapshot-engine.ts` and tests; extend target/session routing; add host fixture scripts. Extend `package/ego-browser/src/clipboard.ts` and tests only for the Linux clipboard backend, preserving native dispatch. Reuse existing `scripts/real-browser-e2e/cases/` fixtures and add missing Linux-specific cases.

**Interfaces:** `snapshot(lease:TaskLease,options:SnapshotOptions):Promise<{content:string,refs:NativeSnapshotRef[]}>`; `NativeSnapshotRef = {refId:number,backendNodeId:number,frameId?:string,role:string,name:string,loc?:string}` with unique per-snapshot refs and correct renderer provenance. Keep the existing native snapshot options and SDK Page ref translation unchanged.

- [ ] Add failing tests for identical backend IDs in multiple renderers, nested/sibling/replaced iframes, cross-origin OOPIF, shadow DOM, full/viewport/subtree captures, partial snapshots, `maxResultLength:0`, stable-locator collisions, navigation invalidation and cross-round refs. Assert each printed actionable ref resolves to its own original node.
- [ ] Walk accessible frame/session topology without focusing targets; implement compact AX serialization and stable locators consistent with upstream requirements. Return documented errors for unknown/ambiguous roots or unavailable frames. Do not silently omit iframe content to satisfy smoke tests.
- [ ] Exercise the full Page surface through the existing SDK: navigation, waits, inputs, clicks, pointer/drag/scroll, screenshots, uploads/downloads, dialogs, popups, network activity and workers. Fix host contracts first; preserve existing upstream behavior and tests.
- [ ] Add Linux clipboard support for the existing `keyboard.paste` contract with cooperating-process serialization and restore-if-unchanged semantics. Detect X11/Wayland and supported native backends; test plain text, Unicode, rich HTML and user clipboard replacement during paste. If a format/backend cannot be restored safely, fail clearly before destructive mutation; do not silently pretend full parity. Keep plain `insertText` behavior independent.
- [ ] Run the entire upstream E2E suite through the real Linux launcher with `EGO_BROWSER_REAL_E2E_ONLY` unset. Save case inventory, failures, unexpected skips and cleanup receipts. A native-only case can be classified only with a reason and an equivalent Linux acceptance fixture; record any unimplemented product behavior as incomplete.
- [ ] Commit `feat(linux): support frame-aware snapshots and full browser workflows`.

## Task 6: Deliver the browser launcher and Spaces control window

**Files:** Create `src/desktop-server.ts`, `src/desktop/{index.html,app.js,style.css}`, desktop controller tests and `assets/ego-lite-linux.desktop`; extend `bin/ego-lite.mjs`, host management API and README.

**Interfaces:** `startDesktopController(host:HostControl):Promise<{url:string,close():Promise<void>}>` returns a local launch URL without logging its bootstrap secret; `HostControl` exposes profile/task inventory plus create/open/reveal/pause/resume/close/stop operations. Controller requests authenticate independently of task capabilities and can affect only this host's owned profiles/processes.

- [ ] Write tests for missing/incorrect auth, foreign Origin/Host, CSRF, controller-target claims by agents, injected task/title HTML, unknown paths, profile/task ownership display and a paused agent attempting takeover. Verify token-free logs and restrictive CSP/CORS behavior.
- [ ] Implement the loopback authenticated UI and desktop entry. It must support profile selection, ordinary signed-in browsing, task state/listing, reveal, Take control, Resume agent, Pause all and close/stop. Show shared-profile semantics without technical clutter. Keep the controller out of task target sets.
- [ ] Make foreground activation explicit to a human action. Default agent target creation/input must leave the user's selected tab and physical pointer alone. Preserve user-created tabs; unproven popups/restored tabs appear in a user-controlled inbox.
- [ ] On a controlled local login/MFA-like fixture, demonstrate the full flow: user signs in, agent uses session, agent delegates, user completes the form, user resumes, agent verifies result. Repeat hard pause during pending automation and show task B continues.
- [ ] Verify keyboard access, state/error feedback and actual desktop behavior on X11 and native Wayland. Distinguish compositor activation refusal from browser failure and show an actionable reveal message. Save sanitized screenshots and version/backend receipts.
- [ ] Commit `feat(linux): add desktop browsing and Spaces control`.

## Task 7: Package, install and document the complete project integration

**Files:** Create `skills/ego-browser/references/install-linux.md`, `skills/ego-browser/scripts/install-linux.sh`, host `scripts/{package,install,uninstall}.mjs` or equivalent shell tools, artifact install tests, and `docs/linux/ATTRIBUTION.md` updates. Modify `package/ego-browser/scripts/render-guide.mjs`, build/skill tests, `skill-body/SKILL.md`, entry skill, shared install router, README/platform docs and needed plugin packaging tests.

**Interfaces:** Produce one relocatable Linux archive containing host runtime, desktop assets, the selected upstream SDK payload, matching `SKILL.linux.md`, entry skill and site learnings. Installer accepts an explicit user prefix and artifact directory/archive; uninstaller defaults to preserving profiles. `ego-browser doctor --json` returns factual checks with separate configured/successfully-probed states, never a hardcoded “sandbox enabled” claim.

- [ ] Test a fresh install into a temp home/prefix with spaces, a conflicting unrelated `ego-browser`, repeat install, upgrade, failed upgrade/rollback, moved/deleted checkout, uninstall and persistent data retention. Assert source-tree symlinks do not escape into the installed payload.
- [ ] Add the Linux platform to `render-guide.mjs` and keep one canonical guide source. The selected SDK and printed guide must always match. Preserve all existing Mac/Windows guide blocks and installation instructions. Teach stable agent identity, task ownership, sign-in and human controls in the Linux guide.
- [ ] Build a versioned artifact and SHA-256 manifest from the verified payload. Use original MIT notices and adapted-code attribution, with community Linux identity. Do not copy vendor benchmark claims or claim native-engine parity.
- [ ] Implement user-level desktop/CLI installation and ownership-aware upgrade/uninstall. Browser/Node requirements are checked clearly. Installing binaries does not alter default browser or copy a personal browser profile. Preserve existing skill installs with backup/explicit ownership checks.
- [ ] Run SDK/style/site checks sequentially, all plugin tests, and `npm --prefix plugins/ego run package`. Extract every plugin payload to unrelated temp directories; verify support paths/adapters and symlink confinement. Test at least one real agent workflow through the installed Linux CLI.
- [ ] Run `npm run test:install --prefix package/ego-linux-host` against the actual archive, outside the source checkout. Commit `feat(linux): ship relocatable desktop install and agent integration`.

## Task 8: Wire CI and execute the release qualification matrix

**Files:** Modify `.github/workflows/ci.yml` or add a focused `.github/workflows/linux.yml`; add host scripts `test:browser`, `test:persistence`, `test:concurrency`, `test:install`; extend full-E2E evidence/cleanup reporting; create `docs/linux/VERIFICATION.md` and machine-readable sanitized receipts under ignored `artifacts/linux/`.

**Interfaces:** Each qualification receipt records exact Git/SDK/artifact SHA, OS/distro/architecture, Node/browser versions, browser backend, sandbox startup evidence, invocation, expected/actual case counts, unexpected skips, failures and cleanup result. `VERIFICATION.md` links sanitized summaries and gives precise rerun commands.

- [ ] Add Linux CI on Node 22 and the current supported LTS, using a sandbox-capable unprivileged browser process. Cover build/types/unit/contract tests, real headless Chrome, Xvfb headed tests, persistence/concurrency and clean artifact installation. Do not default `--no-sandbox` to get CI green.
- [ ] Ensure Linux artifact publishing depends on every required Linux check. Keep upstream stable/beta release guards and native platform behavior. Adapt fork freshness checking to `upstream/dev` when that remote exists, with `origin/dev` only for original upstream checkout; keep the change focused and tested.
- [ ] Run the full SDK, host, plugin, site and packaging checks in the documented order. Capture failed runs and repair the implementation until green; do not lower assertions or silently drop existing cases.
- [ ] On actual Linux desktops, run the installed launcher and full E2E with `EGO_BROWSER_REAL_E2E_CLI` set and `EGO_BROWSER_REAL_E2E_ONLY` unset. Test X11 and native Wayland separately. Verify real Wayland socket/backend use, not just an environment variable. Nested compositors/Xvfb are labelled synthetic and do not certify an actual user desktop.
- [ ] Run Mac/Windows portable regressions in CI. Where official native app access exists, execute the SDK E2E against those apps with `--sdk-path`; otherwise list those live regression gates as unverified, without confusing them with CI unit passes.
- [ ] Record intentional unsupported platforms/features honestly. Do not block all useful implementation on a missing desktop, but do not mark the affected live acceptance rows complete. Commit `ci(linux): qualify browser lifecycle and installation`.

## Task 9: Final independent review, repair and handoff

**Files:** Update `docs/linux/{PROGRESS,ACCEPTANCE,VERIFICATION}.md`, host README, upstream Linux docs and attribution; fix code identified by review in its owning module.

- [ ] Request a fresh review against the full design and diff, focused on persistence, shared-profile authority, human pause, frame refs, packaging and cross-platform regressions. Fix actionable findings and rerun affected checks.
- [ ] Run `git diff --check`, full required qualification commands and artifact checksum verification after final code changes. Confirm no tokens/profile data/generated builds are staged and all original upstream components remain present.
- [ ] Fill every row of `docs/linux/ACCEPTANCE.md` with current evidence or an explicit incomplete reason. Any unresolved core feature means implementation is incomplete; missing real environments mean live qualification is incomplete. Do not invent a successful run.
- [ ] Commit the tested result on `feat/linux-desktop` and push it to `origin` (the user's fork), preserving existing history. Do not force-push, publish a release, merge upstream or send maintainers messages as part of this handoff.
- [ ] Report the runnable Linux launch/install commands, artifact location, commit, exact checks passed and remaining environmental gates. If any work is blocked externally, leave a concrete resume command and current progress; do not substitute another plan for the implemented product.

## Required validation order

```bash
# Run from repository root. SDK build-mutating checks are sequential.
npm ci --prefix package/ego-browser
npm run style:check --prefix package/ego-browser
npm audit --prefix package/ego-browser --registry=https://registry.npmjs.org --audit-level=moderate
npm test --prefix package/ego-browser
npm run validate:site-skills --prefix package/ego-browser
npm ci --prefix package/ego-linux-host
npm test --prefix package/ego-linux-host
npm run typecheck --prefix package/ego-linux-host
npm run style:check --prefix package/ego-linux-host
npm test --prefix plugins/ego
npm run package --prefix plugins/ego

# These scripts are implemented by the tasks above; they do not exist in the scaffold.
npm run test:browser --prefix package/ego-linux-host
npm run test:persistence --prefix package/ego-linux-host
npm run test:concurrency --prefix package/ego-linux-host
npm run test:install --prefix package/ego-linux-host

# Use the actual installed Linux launcher, not a Mac ego executable or test shim.
EGO_BROWSER_REAL_E2E_CLI=/absolute/path/to/installed/ego-browser npm run e2e --prefix package/ego-browser
git diff --check
```

The final executor must distinguish today's upstream baseline from future implementation receipts. Update commands when implementation chooses equivalent script names, keeping the plan, docs, CI and evidence consistent.
