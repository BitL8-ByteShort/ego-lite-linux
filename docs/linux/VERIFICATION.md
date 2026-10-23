# Linux implementation verification — 2026-10-23

This fork implements the additive community Linux host described in `SOL-ONE-SHOT.md`. The original upstream project and MIT license remain present. The proprietary ego lite browser engine/UI is not included. The implementation is runnable; actual X11/Wayland desktop qualification and native Windows application qualification remain external gates.

## Later MSI deployment

The tested archive is installed and open on the MSI. Its usable RustDesk/TigerVNC desktop passed **81/81, 1,346 assertions, 0 skips**, clipboard 8/8 and controller 20 assertions plus visible button checks. A separate focus probe **failed**: agent click brought the task window forward while preserving pointer position. The actual physical Xorg session had a pre-existing GNOME session failure and its full run returned **71/81, 10 failures**. Physical X11/native Wayland remain unqualified. [Installation, limitations and resume commands](MSI-DESKTOP.md); [sanitized receipt](evidence/2026-10-23-msi-desktop.json). The initial receipts below remain valid for their stated environments.

## Source and environment

- Upstream base: `c024c32aa9fb2b4f7ff0524e38e8984bc982db53` (`upstream/dev` at preparation).
- Tested Linux runtime: `6b1863f48b93697b31d66b703edb904553089fcb`. The final source and tested archive agree: all 74 shipped runtime/SDK/guide/skill/installer/asset files were compared byte-for-byte with the current build and matched.
- SDK bundle SHA-256: `d5825a11f17e37fe5ec39715cd63fa5fe85dbbab3aa837290437602bbb8eb0c6`.
- Local preparation/portable tests: macOS ARM64. Actual Linux tests: Debian 12 ARM64, Node `22.23.4`, official Google Chrome for Testing `156.0.8078.47`, in Docker Desktop, as UID 1000. Headless and Xvfb are distinct synthetic qualification modes.
- The Docker test container permits Chromium sandbox startup with `seccomp=unconfined` and `CAP_SYS_ADMIN`. Chromium itself runs without `--no-sandbox`, uses its own private debugging pipe, and its actual renderer processes were checked for `NoNewPrivs: 1` and `Seccomp: 2`. This is browser sandbox evidence, not a claim that this Docker configuration isolates hostile containers.
- Remote CI: Ubuntu 24.04 x86_64, Node 22.23.3 and 24.21.0, official Google Chrome for Testing 156.0.8078.47. Both installed full suites passed 81/81 with 1,346 assertions and 0 skips (225.5 s / 226.9 s). CI enables user namespaces only for the root-owned test executable through a scoped AppArmor profile; it does not disable the global Ubuntu restriction.
- The initial runs did not include a physical Linux desktop, personal-account login or native Windows app. Subsequent MSI attempts and the focus defect are recorded above. Controlled local authentication/storage fixtures were used instead of personal credentials.

## Automated results

| Gate | Observed result | Evidence / reproduction |
|---|---|---|
| SDK build, translation and typecheck/unit suite on Mac | 602 total; 594 passed, 0 failed, 8 explicit platform/display skips | `npm test --prefix package/ego-browser`; `work/linux/` local logs |
| SDK/host style and registry audits; site learnings | Passed; both audits zero vulnerabilities | `npm run style:check --prefix package/ego-browser`; `npm audit --prefix package/ego-browser --registry=https://registry.npmjs.org`; `npm run validate:site-skills --prefix package/ego-browser` |
| Linux host contracts | 57 passed, 0 failed, 0 skipped; typecheck passed | `npm test --prefix package/ego-linux-host`; `npm run typecheck --prefix package/ego-linux-host` |
| Plugins | 42 passed; all nine artifacts packaged and extracted outside this checkout | `npm test --prefix plugins/ego`; `npm run package --prefix plugins/ego`; `artifacts/linux/plugin-extraction-receipt.json` |
| Native Linux X11 clipboard and installer wrapper | 8 passed, 0 failed, 0 skipped under Xvfb | `xvfb-run -a node --test src/linux-clipboard.test.mjs src/linux-installer.test.mjs` from `package/ego-browser`; `work/linux/clipboard-final.log` |
| Persistent browser/profile and two independent clients | Passed: cookie, localStorage, IndexedDB survive complete shutdown; profiles separate; same-profile A/B share controlled login and cannot claim foreign tasks; generation changes | `npm run test:browser`, `test:persistence`, `test:concurrency` with `--prefix package/ego-linux-host`; `work/linux/persistence-concurrency-final.log` |
| Owned lifecycle | Passed simultaneous startup, crash/restart, hard-paused restoration, stale/reused PID safety and unrelated socket preservation | `npm run test:lifecycle --prefix package/ego-linux-host`; `work/linux/lifecycle-final.log` |
| Human controller | 20 assertions passed under Xvfb, including actual HTML refresh, explicit task grant, pending-command hard pause, independent B task, delegation and resume | `npm run test:control --prefix package/ego-linux-host`; `work/linux/control-final.log`; `artifacts/linux/controller-xvfb.png` |
| Full upstream Linux browser suite from installed archive | **81/81 passed, 0 failed, 0 skipped; 1,346 assertions; 201.6 s** | `artifacts/linux/e2e-6b1863f-cft-xvfb/receipt.json`; committed sanitized [receipt](evidence/2026-10-23-qualification.json) |
| Installed CLI forms and desktop launcher | 13 checks passed across five CLI rounds outside checkout, with a spaced prefix and the extracted installer/source removed; launcher opened under Xvfb; stop/uninstall cleanup passed | `artifacts/linux/cli-forms-receipt.json`; committed [receipt](evidence/2026-10-23-qualification.json) |
| Installed relocation, upgrade and uninstall | Passed 15 installer contracts and real relocated workflow/later round; cookie/localStorage/IndexedDB survive full old process termination, changed code/payload switch and a new generation | `npm run test:install --prefix package/ego-linux-host`; `artifacts/linux/install-receipt.json` |
| Fork freshness | 4 contract tests passed | `node --test scripts/check-branch-freshness.test.mjs` |
| GitHub Linux / Mac / Windows matrix | **All 5 jobs passed**: Linux Node 22/LTS, Mac/Windows portable, and the dependent qualified artifact gate at `6b1863f` | [GitHub Actions run 40021709556](https://github.com/BitL8-ByteShort/ego-lite-linux/actions/runs/40021709556); committed [CI receipt](evidence/2026-10-23-ci.json) |

Raw logs and archives are intentionally ignored under `work/linux/` and `artifacts/linux/`. This committed report and `ACCEPTANCE.md` are the sanitized durable summary. A test run that failed or skipped required cases is not a successful receipt.

## Native Mac comparison

The installed official Mac application was available. The full current SDK E2E ran through its native CLI with an explicit `--sdk-path`: **78/81 passed, 3 failed, 0 skipped, 1,327 assertions**. Failures were `Page Playwright selector compatibility`, `Page OOPIF actions` (both element not visible), and the dependent `Page OOPIF restore and close` (missing prior-case output).

A separate diagnostic rebuilt the unchanged upstream base `c024c32` in an isolated temporary source snapshot and reran those three cases against the same official Mac application. All three failed with the same causes (20 assertions; the other 78 cases were intentionally skipped in this diagnostic). This establishes reproducibility on the unchanged upstream SDK; it does not turn the native full run into a pass. Logs: `work/linux/native-mac-e2e.log` and `work/linux/native-baseline-diagnostic.log`. No proprietary Mac application files were changed.

## Reviewed behavior and limits

Independent review findings were repaired: stale-PID startup races, personal download names/destination, controller refresh authentication, explicit human-created task grants, operational error display, installer prerequisites and protected form values. Later focused reviews found no actionable issue in the narrow worklet-release authority, owned viewport commands, or PDF save-path compatibility setting. Regression tests and real browser checks cover the relevant changes.

Task authorization uses client/agent identity, target/session lineage, capability, epoch and browser generation. Shared-profile tasks intentionally share website sessions and storage. They are not separate account or OS security boundaries. Use a different named profile for separate accounts. CLI invocations expose one selected named profile; select another with `--profile` or the controller.

Task pages use independent background windows and internal renderer focus emulation so background screenshots/input work without a `Target.activateTarget` request or physical pointer movement. The later MSI virtual desktop measurement found that agent mouse input activates its task window; foreground preservation is an open defect. Physical desktop focus remains unqualified. The optional native cursor animation binding returns an explicit unsupported error. `egoAutomated` provides event-filtering compatibility; it cannot reproduce proprietary renderer anti-detection behavior.

The host allows the two session-scoped viewport metric commands used by the existing SDK fixtures. It disables only `PdfGetSaveDataInBlocks`: the alternate chunked PDF-save path uses a native file writer and bypasses the browser download events required by the SDK. Live stock-Chrome A/B checks reproduced this difference; the unchanged PDF test then passed 13 assertions, and viewer/annotation controls remain enabled. The [Chromium feature definition](https://chromium.googlesource.com/chromium/src/+/main/pdf/pdf_features.cc) and final full-suite receipt document this compatibility setting.

Downloads use verified frame/target ownership and copied-file completion receipts. Normal personal names/destinations are retained. While a task download is armed, shared-profile browser download allowance can also suppress a personal Save As prompt; allowance returns to default after the interception/active download ends. This is a documented shared-context limitation.

The X11 clipboard backend preserves supported rich/plain formats and restores only if ownership has not changed. Native Wayland clipboard paste fails clearly before mutation because reliable restoration is not implemented there; plain `insertText` remains available. Xvfb clipboard results do not qualify a physical X11 session.

## Install and run

The primary x86_64 archive is `artifacts/linux/ego-lite-linux-0.1.0-dev.0-linux-x64.tar.gz`, SHA-256 `f007f64fb442f741ad1a7d81239e8416dfa556c1ea0832eff3f2a2a68a6f81de`. It was downloaded from the successful dependent CI artifact gate and its checksum verified locally. The source commit and SDK hash match the final runtime. Its two complete installed suites passed on Node 22.23.3 and 24.21.0. No public release was created.

The exact full-suite-tested ARM64 archive is `artifacts/linux/ego-lite-linux-0.1.0-dev.0-linux-arm64.tar.gz`, SHA-256 `d0bb4136a8e3efe5d493b5801d07c7d26c1a5b86caa634f49b505262b1821a56`. Its embedded source commit is `6b1863f48b93697b31d66b703edb904553089fcb`, matching the full-suite receipt. The installed runtime SDK hash equals the packaged SDK hash. The archive remained unchanged through changed-code upgrade verification. All containers created for this run were removed after their receipts were saved. Use its adjacent checksum; see the committed [sanitized receipt](evidence/2026-10-23-qualification.json). Check the archive architecture (`x64` or `arm64`) against the intended Linux machine. Node 22+, sandbox-capable Chrome/Chromium 156+ and util-linux `flock` are external prerequisites.

```bash
sha256sum --check ego-lite-linux-0.1.0-dev.0-linux-ARCH.tar.gz.sha256
tar -xzf ego-lite-linux-0.1.0-dev.0-linux-ARCH.tar.gz
cd ego-lite-linux-0.1.0-dev.0-linux-ARCH
node host/scripts/install.mjs --prefix "$HOME/.local"
"$HOME/.local/bin/ego-browser" doctor --json
"$HOME/.local/bin/ego-lite" --profile default
```

Replace `ARCH` with the actual archive's architecture. Installation and uninstall details are in [installation.md](installation.md). The desktop launcher opens personal browsing and the Spaces controller. Sign in manually in personal browsing; agents in that profile share the resulting session.

For each independent agent workflow, generate an identity once and retain it across rounds:

```bash
export EGO_LINUX_AGENT_ID="$(node -p 'crypto.randomUUID()')"
"$HOME/.local/bin/ego-browser" skill
"$HOME/.local/bin/ego-browser" nodejs <<'JS'
const task = await taskSpace('Example');
const page = task.page('p1');
await page.goto('https://example.com');
cliLog(await page.snapshot());
JS
```

## Remaining live qualification and resume commands

Run these from the checkout on the intended Linux desktop, as an ordinary user, with its real display session. Install/build dependencies first. Use a dedicated qualification profile; do not import a live personal profile.

```bash
export EGO_LINUX_PROFILE=desktop-qualification
export EGO_LINUX_AGENT_ID=desktop-qualification
export EGO_LINUX_HEADLESS=0
export EGO_BROWSER_REAL_E2E_CLI="$HOME/.local/bin/ego-browser"
unset EGO_BROWSER_REAL_E2E_ONLY
npm run e2e --prefix package/ego-browser
npm run test:control --prefix package/ego-linux-host
"$HOME/.local/bin/ego-lite" --profile desktop-qualification
```

For X11, verify the actual session is X11, then run the clipboard tests above and manually check physical pointer/focus, reveal, hard pause during dialogs/Fetch, and human login/resume. For native Wayland, launch within the real Wayland session (without XWayland fallback), verify Chromium's actual Ozone backend in `chrome://gpu`, and record the compositor/backend. A configured `WAYLAND_DISPLAY` alone is not proof. Repeat the full E2E/controller checks and record the explicit clipboard limitation. If it uses XWayland, the native Wayland gate remains open.

For native Windows, install/open the official native application and run the original `npm run e2e --prefix package/ego-browser` with `EGO_BROWSER_REAL_E2E_CLI` set to its CLI. Windows portable CI and native live application results are separate gates.

Do not mark A23/A24 or native Windows live acceptance passed until those actual runs and human checks exist. No release, upstream merge or maintainer contact is authorized by this implementation run.
