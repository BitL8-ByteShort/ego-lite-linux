# Linux implementation progress

## Current direction — official browser through Wine

Chris superseded the community Chromium-host approach with the actual official ego browser. The MSI now has the official Windows ego lite 0.6.0.22 app running under Wine 11.20, with its own bundled native agent CLI and Spaces interface. Continue this route; the historical host test results below do not qualify the Wine installation. See [WINE.md](WINE.md) for the installed commands, passed native-agent checks, and remaining blank Space-preview limitation.

## Preparation — 2026-10-23

- [x] Fork original repository into `BitL8-ByteShort/ego-lite-linux`.
- [x] Clone full project to `/Users/chris/Projects/ego-lite-linux`.
- [x] Configure `origin` as the fork and `upstream` as Citro.
- [x] Fetch pinned Linux proposal references without merging them.
- [x] Create `feat/linux-desktop` from current upstream dev.
- [x] Add host directory/manifest scaffold, model settings and one-shot launch script.
- [x] Inspect current source and prior proposals; write design, plan, acceptance and source lock.
- [x] Finish independent design/plan review; fix the RPC frame-limit inconsistency and move full E2E qualification after snapshot implementation.
- [x] Verify scaffold JSON, shell syntax, read-only preflight and Sol launcher `--check` mode.

## Baseline verification

Preparation host: macOS; Node `v26.10.0`, npm `11.19.1`. Base SDK: `c024c32aa9fb2b4f7ff0524e38e8984bc982db53`.

- `CI=true npm ci --prefix package/ego-browser`: passed; 29 packages added; install audit reported zero vulnerabilities. CI mode intentionally did not install repository Git hooks during planning.
- `npm test --prefix package/ego-browser`: **586 passed, 0 failed, 0 skipped**. Includes SDK build/typecheck/translation checks and tests.
- `npm run style:check --prefix package/ego-browser`: passed.
- `npm test --prefix plugins/ego`: **37 passed, 0 failed, 0 skipped**, including artifact packaging checks.
- `npm run validate:site-skills --prefix package/ego-browser`: passed.
- `bash -n scripts/linux/start-sol.sh scripts/linux/preflight.sh`: passed.
- `./scripts/linux/start-sol.sh --check`: passed; selected `gpt-6.1-sol` with `xhigh`, without launching implementation.
- `./scripts/linux/preflight.sh`: passed on the preparation host; confirms this is macOS and does not qualify Linux behavior.
- During preparation, live Linux browser / X11 / Wayland qualification was **not run**; the results below supersede that implementation state.

Raw preparation logs are local under ignored `work/`. They contain baseline output, not Linux completion evidence.

## Implementation — 2026-10-23

- [x] Task 1 — host contracts/package/private framed transport.
- [x] Task 2 — owned sandboxed Chromium, kernel startup lock and persistent named profiles.
- [x] Task 3 — task authority, leases, target/session lineage, scoped events/downloads and immediate human revocation.
- [x] Task 4 — complete CLI/native adapter and matching SDK loading; native bindings retain precedence.
- [x] Task 5 — frame-aware snapshots, browser surface, cross-round refs and safe X11 clipboard. Native Wayland clipboard returns an explicit pre-mutation unsupported error.
- [x] Task 6 — personal browsing and authenticated Spaces controller with manual task grants, pause/takeover/resume and inbox adoption.
- [x] Task 7 — relocatable installer/archive, upgrade/rollback/uninstall contracts, guides/plugins/attribution.
- [x] Task 8 — every feasible automated Linux/portable CI gate complete. Physical X11/native Wayland and native Windows application qualification remain external gates, recorded in A23/A24/A25.
- [x] Task 9 — independent review findings resolved; exact receipts, archive checksums and final verification report recorded. Tested runtime pushed to the fork.

Final tested runtime: `6b1863f48b93697b31d66b703edb904553089fcb`. The clean installed ARM64 archive passed the full unchanged browser suite: **81/81 cases, 1,346 assertions, 0 failures, 0 skips**, using official Chrome for Testing 156.0.8078.47 and Node 22.23.4 under Xvfb. Twenty observed renderer processes had NoNewPrivs=1 and Seccomp=2. Chromium retained its sandbox; the Docker startup allowances are documented separately in VERIFICATION.md. All 74 shipped runtime/SDK/guide/skill/installer/asset files match the current build byte-for-byte.

The final GitHub Actions matrix at that exact runtime passed **all five jobs**: Linux Node 22 and LTS, native Mac/Windows portable checks, and the dependent qualified artifact gate. Both x86_64 installed browser suites passed **81/81, 1,346 assertions, 0 skips**. The gated x86_64 archive was downloaded and checksum-verified. [CI run 40021709556](https://github.com/BitL8-ByteShort/ego-lite-linux/actions/runs/40021709556).

Final local checks: SDK **602 total, 594 passed, 0 failed, 8 explicit OS/display skips**; host **57/57**; plugins **42/42** and all nine archives extracted outside the checkout. SDK/host types and styles, site validation and registry audits pass; both registry audits reported zero vulnerabilities. Native X11 clipboard/wrapper tests passed **8/8** under Xvfb. Real lifecycle, persistence and concurrent-client fixtures passed. The authenticated controller passed **20 assertions** with actual HTML refresh, explicit task grant, immediate pending-command hard pause, independent B task, delegation and resume. These remain synthetic-display results.

Installed qualification used the final ARM64 artifact: **15/15 installer contracts**, an actual changed-code upgrade `8f1cd49` → `6b1863f`, complete old-process termination, changed generation, cookie/localStorage/IndexedDB preservation and profile-retaining uninstall. A separate installed all-form check passed **13 checks across five CLI rounds**, including the desktop launcher under Xvfb, bare stdin, nodejs stdin/-e/file, matching --sdk-path, idempotent stop and uninstall. It ran outside the checkout with a spaced installation prefix after deleting the extracted installer/source directory.

The final compatibility fixes permit only the two owned-session viewport methods needed by existing SDK fixtures and disable only Chromium's `PdfGetSaveDataInBlocks` feature so original PDF downloads remain observable through browser download events. The complete final browser suites include the unchanged scrolling and PDF cases. Annotation controls remain enabled. Focused independent reviews found no actionable issue in those fixes or the narrow related-worklet resume/detach authority.

Native Mac full suite returned **78/81 with 3 failures, 0 skips**. All three causes reproduce on unchanged upstream `c024c32`; this is a recorded native failure. Native Windows application access and actual physical X11/native Wayland desktops were unavailable. Native Wayland clipboard paste explicitly fails before mutation; plain insertText remains available.

The final acceptance ledger and sanitized JSON receipts are committed with VERIFICATION.md. Versioned x64 and ARM64 archives, adjacent checksums and manifests are local under ignored `artifacts/linux/`; raw logs are under ignored `work/linux/`. All containers created for this run were removed. No public release, upstream merge or maintainer contact occurred.

Remaining actions are external qualification only: use the concrete desktop/backend/native-application commands and human checks in [VERIFICATION.md](VERIFICATION.md). Do not restart completed implementation or substitute synthetic-display receipts for physical desktop qualification.

## MSI deployment follow-up — 2026-10-23

Installed exact runtime `6b1863f` and checksum-verified x64 archive on MSI Ubuntu 24.04.5/Node 24.21.0. Pinned CfT156 alongside unchanged Chrome155, using its existing sandbox helper without root changes. Applications launcher and shell environment configured; default profile is open, no agent tasks. RustDesk connects to TigerVNC `:1`: full unfiltered installed suite **81/81 / 1,346 / 0 skips**, clipboard **8/8** with original contents restored, controller **20 assertions**, and visible CUA takeover/resume/Pause all checks passed.

Desktop focus probe found an **open defect**: agent click activates its task window; create/navigation/fill preserved focus and all steps preserved pointer. Do not claim A18 passed. Physical Xorg `:2` has a pre-existing GNOME failure process (October 5) and no active foreground window; full actual-session attempt **71/81, 10 failures, 0 skips**, not qualified. Native Wayland unavailable. Chris was asked to restore the physical session; no logout/restart was performed. Current next work is click-activation repair plus physical desktop/backend/accessibility qualification after that session is usable. Detailed installed commands and both receipts are in MSI-DESKTOP.md. Qualification browsers stopped; the default user browser remains open for trial.
