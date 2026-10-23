# Linux acceptance and evidence ledger

All implementation rows start **not implemented**. The planning scaffold is not product completion. The executor updates each row with the command, commit and evidence path; `pass` requires observed behavior. Use `blocked: <specific environment>` only for an external qualification dependency, not unfinished code.

| ID | Required outcome | Primary task | Status / evidence |
|---|---|---|---|
| A01 | Full upstream SDK, v1/v2 API, skills, learnings, plugins and MIT attribution retained | 1, 4, 7 | Not implemented |
| A02 | Linux-owned sandboxed Chromium uses private pipe; no foreign browser attachment | 2 | Not implemented |
| A03 | Dedicated named profile preserves cookie/localStorage/IndexedDB through complete browser/host restart and code upgrade | 2 | Not implemented |
| A04 | Separate named profiles keep account state separate; same-profile tasks share a controlled login intentionally | 2, 3 | Not implemented |
| A05 | Concurrent CLI clients keep task selection, CDP request IDs, sessions, popups, events and downloads correctly scoped | 3 | Not implemented |
| A06 | Foreign task/session/target/embedded parameter access rejected; user/controller tabs never silently claimed | 3 | Not implemented |
| A07 | User hard pause revokes queued work and future commands; dialog/Fetch/long wait does not freeze human control | 3, 6 | Not implemented |
| A08 | Delegated handoff, user hard pause, resume, completed/closed tasks and headless errors behave distinctly and correctly | 3, 6 | Not implemented |
| A09 | Restart invalidates stale refs/capabilities; unproven restored tabs stay user-owned | 2–5 | Not implemented |
| A10 | Bare stdin, nodejs stdin/-e/file, skill, help, doctor/status/stop/open and --sdk-path work from installed payload | 4, 7 | Not implemented |
| A11 | SDK/guide alignment; native bindings preserved; help/skill/import has no unintended browser launch | 4, 7 | Not implemented |
| A12 | Main frame, same-origin iframe, OOPIF and shadow-DOM snapshots/actions; repeated backend IDs resolve correctly | 5 | Not implemented |
| A13 | Full/viewport/subtree/interactive/truncation/locator/ref lifetime contracts, including separate CLI rounds | 5 | Not implemented |
| A14 | Full current upstream browser suite: navigation, waits, input, drag, screenshots, downloads/uploads, dialogs, popups, workers | 5, 8 | Not implemented |
| A15 | Linux plain/rich clipboard semantics, Unicode, safe restore and user change during paste | 5, 8 | Not implemented |
| A16 | Desktop launcher opens personal browsing and Spaces UI; profile/task controls and accessible feedback work | 6 | Not implemented |
| A17 | Authentication-like human handoff flow completes; agent consumes persistent login | 6 | Not implemented |
| A18 | Ordinary automation does not move physical pointer or activate user tabs; explicit reveal is handled accurately | 6, 8 | Not implemented |
| A19 | Local UI auth/Origin/Host/CSP and task-text escaping; no public raw CDP/control exposure | 6 | Not implemented |
| A20 | Relocatable archive installs outside checkout; path spaces, unrelated-command collision, upgrade/rollback/uninstall preserve profiles | 7 | Not implemented |
| A21 | Linux platform guide/install routing, all plugin artifacts and a real installed agent workflow work | 7 | Not implemented |
| A22 | SDK/host/unit/type/style/audit/plugin/site checks and sandboxed Linux CI pass; Linux artifacts depend on Linux checks | 8 | Not implemented |
| A23 | Actual X11 desktop qualification, full E2E and human controls recorded | 8 | Not run |
| A24 | Actual native Wayland desktop qualification, verified backend and full E2E/human controls recorded | 8 | Not run |
| A25 | Mac/Windows portable regressions pass; native app live E2E separately recorded when available | 8 | Not run after implementation |
| A26 | Independent review resolved, clean diff, checksums, reproducible install/run commands and verification report | 9 | Not implemented |

## Receipt minimum

Record Git SHA, SDK/artifact SHA, Node version, browser version, Linux distro/architecture, actual display backend/compositor, sandbox startup evidence, installed launcher path, exact command, expected/actual case counts, failures/skips and process/profile cleanup. Sanitize URLs, titles, usernames and authentication material. Keep raw artifacts ignored; commit a sanitized summary.

## Evidence levels

- Unit/contract fixture: validates logic, including fake transports and fake AX trees.
- Real headless Chromium: validates actual browser behavior and process persistence.
- Xvfb or nested compositor: validates synthetic headed behavior.
- Actual X11 / native Wayland desktop: validates the user's desktop experience. XWayland is not native Wayland.
- Personal-site qualification: optional separate human sign-in; never required to automate credentials or bypass MFA.

An exit code of zero with unexpected skipped cases is not a full-suite pass. A timeout, unavailable browser or absent desktop is not a pass. Native-only engine functionality requires an explicit capability/limitation entry and equivalent required Linux user behavior; it must not be silently omitted.
