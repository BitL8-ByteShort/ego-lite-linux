# Linux implementation progress

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
- Live Linux browser / X11 / Wayland qualification: **not run**; Linux implementation has not started.

Raw preparation logs are local under ignored `work/`. They contain baseline output, not Linux completion evidence.

## Implementation — Sol updates this section

- [ ] Task 1 — host contracts/package/transport.
- [ ] Task 2 — owned Chromium and persistent profiles.
- [ ] Task 3 — task authority, leases and CDP routing.
- [ ] Task 4 — complete CLI/native adapter and SDK loading.
- [ ] Task 5 — frame snapshots, browser features and Linux clipboard.
- [ ] Task 6 — desktop browser and Spaces controller.
- [ ] Task 7 — installer/artifact/docs/plugins.
- [ ] Task 8 — CI and actual platform qualification.
- [ ] Task 9 — independent review, final tests and pushed result.

Next action: start the prepared Sol implementation with `./scripts/linux/start-sol.sh`, or open this directory in Codex and execute `docs/linux/SOL-ONE-SHOT.md` using `gpt-6.1-sol` / `xhigh`.
