# Linux desktop design for ego lite

Date: 2026-10-23. Prepared for Chris's requested single implementation handoff to GPT-6.1 Sol with `xhigh` reasoning.

## Intent and scope

Chris wants to use ego's browser workflow on Linux now, using a fork of the original project and preserving its full SDK/skill/plugin ecosystem. The result must be a usable desktop browser experience with persistent sign-ins and a clear human/agent control model, not merely a package that builds or a homepage screenshot.

The upstream repository explicitly excludes the closed-source Citro browser application and native engine bindings. This design supplies a compatible Linux host around stock Chromium. The existing upstream runtime continues to implement the agent APIs. A small desktop companion provides Spaces, profile selection and human control. Exact reproduction of proprietary native chrome, engine-only snapshot optimizations and vendor branding/benchmark claims is outside this build. The release must identify itself as a community Linux build.

The user delegated planning and scaffolding. The architecture below is the planner's selected approach, grounded in the preceding review; it is not a claim that Chris specified every detail. The one-shot execution prompt instructs the implementer to complete this design without another routine planning/approval loop.

## Approaches and selected decision

1. Compile the original native browser for Linux: unavailable because its source is absent. Reimplementing a Chromium fork would multiply maintenance and is not required for the desired workflow.
2. Install PR #291 unchanged: useful pipe transport and ownership mechanics, but temporary profiles and isolated ephemeral contexts lose task logins on shutdown and do not share the user's signed-in state.
3. Build an additive Linux host that loads the upstream SDK, adapting #291's owned transport and #202's persistence work. **Selected:** maintain the full original repository and make a sibling `package/ego-linux-host/`. Use a persistent shared profile by default, explicit task-target ownership and a visible Spaces controller. This fits the existing `globalThis.ego` extension boundary and avoids a fork of the helper runtime.

## Global constraints

- Fork lineage: `citrolabs/ego-lite` → `BitL8-ByteShort/ego-lite-linux`; preserve upstream MIT license and attribution.
- Base: upstream `dev` commit `c024c32aa9fb2b4f7ff0524e38e8984bc982db53`; working branch `feat/linux-desktop`.
- Runtime: Node.js **22 or later**, ESM TypeScript, `.js` import extensions, Node's built-in test runner.
- Preserve upstream v2 `TaskSpace`/`Page`, frozen v1 compatibility helpers, public schema/help, site learnings and every plugin adapter.
- The Linux host is additive. Existing native `globalThis.ego` wins; imports and help on macOS/Windows must never launch the Linux host.
- Browser: owned Chrome/Chromium process, sandbox enabled, private DevTools pipe, dedicated user-data directory. No auto-attachment to an unrelated debugging port or live personal browser profile.
- Persistent profile data lives under `$XDG_DATA_HOME/ego-lite-linux` (fallback `~/.local/share/ego-lite-linux`); configuration under `$XDG_CONFIG_HOME/ego-lite-linux`; runtime sockets/locks under a validated private `$XDG_RUNTIME_DIR/ego-lite-linux` or a short, owner-only fallback. Data directories `0700`, private state files and sockets `0600`.
- First supported distribution: Ubuntu 24.04+ / Debian-family Linux x86_64 with an available sandbox-capable Chrome/Chromium. X11 and Wayland are separate validation targets. Other distros and ARM64 are best-effort until tested; detect and report rather than advertise unverified support.
- Default mode is headed when a desktop is available. Headless is explicit and rejects GUI-only takeover operations with an actionable error.
- No hidden system-wide installation, default-browser change, personal-profile copy, credential extraction or automatic site login. User-level installation and sign-in in the owned browser are sufficient.
- Shared-profile task separation is **operational tab/command ownership**, not isolation of cookies, account data, same-origin storage, service workers or website actions. Named profiles provide account separation.
- No credentials, personal cookies, authorization tokens or private browsing data in Git, logs, fixtures or acceptance artifacts.

## User experience

`ego-lite` launches the Linux browser and its Spaces controller. The first launch creates a named default profile, opens an ordinary browsing window and explains that signing in there persists across normal restarts. The user can keep browsing normally while agents work in separate tabs/windows belonging to their tasks.

The controller shows profile, task name, ownership, state, recent tab titles and last error. Required actions: create/open a profile, open personal browsing, create a task, reveal a task, Take control, Resume agent, Pause all, close task, and stop the owned browser. User-created personal tabs and controller tabs are never silently assigned to an agent. The interface includes a brief explanation of shared logins within a profile and separate profiles for separate identities.

Normal automation creates background targets and sends targeted CDP input, without using the physical mouse or calling focus/activate operations. Explicit human Reveal/Take control can request foreground activation. Wayland compositors decide whether activation is granted; the UI must report when the user needs to select the window. Do not claim universally silent initial process launch or universal programmatic foregrounding.

First-run sign-in and real-site MFA remain human actions. Controlled local authentication fixtures must still prove persistence without waiting for access to any personal account.

## Process and SDK structure

The installed `ego-browser` Linux wrapper supports `skill`, `nodejs` with stdin, `nodejs -e <code>`, `nodejs <file.mjs>`, the upstream `--sdk-path <absolute index.js>` override, and the existing bare-stdin form. Management commands are `doctor [--json]`, `status`, `stop` and `open`. `ego-lite` is the desktop entry point. Unknown arguments fail with usage and nonzero exit status.

For script execution, resolve configuration, establish the Linux adapter as `globalThis.ego`, dynamically import the selected SDK bundle, then call its exported `runMain` with explicit stdin/argv. This import order prevents startup races and reuses the existing execution, output, schema and helper logic. Validate the selected SDK and matching guide/assets layout. `skill` reads the guide adjacent to the SDK, preferring `SKILL.linux.md`, and does not require a running browser. `--sdk-path` never rewrites installed application files.

Use a long-lived per-profile daemon and short-lived CLI clients. The daemon owns Chromium and its pipe. Private Unix RPC carries versioned messages and bounded payloads. Profile identity is stable across code upgrades; do not hash the host source into the durable profile path. A protocol/version mismatch fails clearly or performs a controlled reconnect; it must not silently create a new empty identity.

`ego.useTaskSpace(id)` remains synchronous, selecting only the current CLI invocation. Each outgoing request captures its current selection. No daemon-global selected task is permitted.

## Profiles and restart behavior

One live Chromium process owns each named persistent profile. Task tabs use that process's default browser context and therefore inherit sign-ins. An optional explicit ephemeral mode may use separate BrowserContexts; it is never the default and is labelled temporary.

Persist logical profile/task IDs, names, ownership state and user-facing metadata atomically. Do not persist capabilities, CDP session IDs, renderer references or target IDs as authority across a browser restart. A new browser generation invalidates old sessions and snapshot refs. The SDK's Page ledger must be namespaced by profile and generation, while remaining stable across CLI rounds within one generation.

Graceful shutdown closes only the owned browser and preserves its profile. Chromium handles cookies/localStorage/IndexedDB persistence. Shutdown never removes persistent profile contents. Crash recovery validates exclusive ownership and process identity; it never kills an unrelated process because a PID was reused.

After a full browser restart, existing task metadata remains visible, but restored tabs whose ownership cannot be proven go to the user's inbox. Do not infer authorization from a matching title or URL. Tasks can create new tabs with the same stored sign-ins; a user can explicitly reassign restored tabs. This is preferable to silently acting in the wrong restored page.

## Agent identity, leases and routing

The CLI accepts `--agent-id` and `EGO_LINUX_AGENT_ID` as stable workflow identity. The Linux usage guide instructs each agent task to create and retain a non-secret random identity once for its lifetime. A desktop/manual session may use an explicit `interactive` identity. Diagnostics clearly report the identity source; integrations must not invent undocumented harness environment variables. Simultaneous agents in tests always use distinct identities.

Every mutating/observing task request carries a client identity, task ID, daemon-issued task capability, lease epoch and browser generation. Task IDs/names locate tasks but do not authorize access. An existing agent-owned task can be resumed by its owning identity across CLI rounds through private host-issued capability state. Other agents can read public task summaries but cannot acquire it silently. Capabilities prevent accidental cross-task access inside this host; same-user arbitrary Node scripts are not an OS security boundary.

One active mutation lease per task; different tasks operate concurrently. A disconnected client's lease is released in a bounded, tested way. Long waits in task A do not block task B or the human control plane. Persisted ownership defaults safely to user control after a daemon crash until a valid agent resumption or explicit handoff occurs.

Maintain explicit `targetId → task/profile/generation` and `sessionId → client/task/target/epoch` registries. Register task-created tabs before exposing them. Popups inherit ownership only from a verified owned opener. Same-process iframes/OOPIF sessions inherit verified frame lineage. Unknown targets, global shared workers and personal/controller windows do not automatically become task-owned.

Translate CDP request IDs per client; route responses only to the originator. Filter events again at delivery time to respect revocation. The mediator validates target/session/context IDs embedded inside parameters as well as the outer message. It must not use `browserContextId` as the ownership check for shared-profile tasks.

Allow only methods and parameter shapes the SDK needs, using an audited inventory. Mediate target creation/discovery/attachment/close, downloads and permitted frame auto-attach. Reject browser-wide shutdown, arbitrary context management, nested raw CDP sends, DevTools exposure, global auto-attach, and browser-wide cookie/cache mutation. A broad domain allowlist is insufficient. Use deterministic fixtures to identify a missing legitimate SDK method; do not solve failures by permitting an entire CDP domain.

## Human control and lifecycle

The controller can pause one task or all tasks. It first revokes epochs, blocks new commands and invalidates queued commands, then detaches task sessions and releases owned debugger/Fetch pauses. Acknowledgment means no subsequent agent command can start; an already dispatched website action cannot be undone and must be reported as such if still in flight.

Keep upstream delegated handoff distinct from a user-enforced pause. `takeOverTaskSpace` can resume a delegated task when the documented workflow permits, but cannot override a hard user pause. Resume agent in the controller clears that latch. Completed tasks retained for the user require explicit claim before reuse; closing a task closes only its registered tabs and never deletes shared sign-ins.

Ownership checks cover all browser paths: normal APIs, direct CDP, pending requests, events, downloads, popups and snapshot internals. Headless mode cannot claim successful visual handoff.

## Snapshots, input and browser features

Use Chromium's accessibility tree and frame/session topology to produce the native binding's snapshot result. Cover the main document, ordinary iframes, cross-origin OOPIFs and shadow DOM as supported by AX/DOM. Emit unique snapshot `refId`, renderer-local `backendNodeId`, and frame provenance; preserve the SDK's own Page ref/ledger identity. Never equate a renderer-local backend node ID with a globally unique ref.

Match documented scope, interactive-only, action marks, locator and truncation semantics. `maxResultLength: 0` means unlimited. Stable locators are emitted only when they uniquely resolve to the original node. Honor current implemented subtree API, while preserving explicit errors for unsupported/ambiguous roots. Snapshot capture must not focus/reload pages.

Browser acceptance covers navigation, waits, buttons/forms, rich editors, keyboard shortcuts, scrolling, drag, screenshots, uploads/downloads, dialogs, popups, workers, multiple profiles and round-to-round refs. Reuse existing drivers. Linux clipboard behavior belongs behind the existing platform dispatcher: preserve/restore the supported formats, account for user changes and serialize cooperating processes. Prefer direct text insertion for plain text where the API already allows it. Rich-paste limitations must be surfaced and tested on X11 and Wayland, never reported as silent success.

## Desktop controller boundary

A small static HTML/CSS/JS UI served by the host on an ephemeral loopback port is sufficient. Keep it out of task targets. Use a per-launch random bootstrap secret delivered only to the owned UI, then authenticated requests. Never log the secret. Validate Host/Origin, require a token plus same-origin checks on mutations, forbid permissive CORS, use a restrictive CSP, escape task/site text and serve no arbitrary filesystem paths. A random port alone is not authorization. API access remains local; there is no remote gateway in this scope.

The controller needs no React framework, Electron distribution or new rendering engine. It should remain small, keyboard accessible and usable in a standard Chromium window/app window. A `.desktop` entry opens it and the owned persistent browser.

## Packaging and upstream alignment

Retain `AGENTS.md` and upstream README as project-wide material; add accurate Linux documentation and community-build identity. Add `install-linux.md`, a Linux guide generated through the existing renderer, a user-level installer/uninstaller and a versioned Linux payload containing host, SDK, matching guides and learnings. Do not publish under a Citro-owned npm namespace.

Use a sibling private package and the existing TypeScript/esbuild/Node test patterns. Source/license provenance for reused PR code goes into `docs/linux/ATTRIBUTION.md` with commit hashes and links. Preserve original authorship where commits can be cleanly applied; otherwise document adapted source provenance.

Installer verifies Node/browser support, installs only to a supplied user prefix, quotes paths, refuses to overwrite an unrelated command, registers desktop files, and prints an actionable doctor result. It does not automatically install root packages or change the default browser. Updates preserve profiles; uninstall removes binaries/desktop integration and retains profile data unless separately and explicitly requested.

CI must cover SDK/platform regressions, Linux unit/contract tests, real sandboxed headless and Xvfb browser tests, and artifact install tests. Linux artifact/release jobs depend on those Linux checks. Existing Mac/Windows jobs and plugin outputs remain valid. Test standard upstream E2E through the new CLI's real `--sdk-path` support, not an uncommitted temporary adapter.

## Completion and what the builder may decide

All acceptance rows in `docs/linux/ACCEPTANCE.md` must have current evidence. Automated local fixtures establish behavior without personal accounts. Real native desktop evidence is recorded separately from Xvfb/nested-compositor evidence. If no suitable Linux host is reachable, complete all possible implementation and artifact work, record the exact remaining desktop gates, and do not call the product live-verified.

The builder may choose modest internal type names, UI layout, exact dependency versions compatible with Node 22, and file splits that preserve the boundaries above. They may fix discovered design flaws autonomously if they update the design/plan and preserve the user outcome. They may not silently drop persistent shared sign-ins, human control, concurrency, full SDK compatibility or installation to make tests pass.
