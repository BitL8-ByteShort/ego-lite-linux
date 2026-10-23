# Execute the ego lite Linux desktop implementation

You are the implementation owner for this project. The requested model is **GPT-6.1 Sol (`gpt-6.1-sol`) with Very high / Extra high (`xhigh`) reasoning**. Complete the Linux browser work in one sustained run, including tests, fixes, packaging and final review. Do not stop at another plan, an SDK build, a mock browser, or an initial smoke test.

Chris's request: he needs ego browser on Linux, wants it aligned with the entire original project, and asked for an original-repository fork, a new Projects directory, a scaffold and a one-shot implementation handoff for you. This checkout is that prepared fork. Routine implementation decisions and fixes are delegated to you. Do not reopen the planning/execution-method selection process.

## Read before editing

1. `AGENTS.md` and `CONTRIBUTING.md`.
2. `docs/superpowers/specs/2026-10-23-linux-desktop-design.md`.
3. `docs/superpowers/plans/2026-10-23-linux-desktop.md`.
4. `docs/linux/UPSTREAM-AUDIT.md`, `SOURCE-LOCK.json`, `ACCEPTANCE.md` and `PROGRESS.md`.

Then execute the plan, using the applicable implementation skills. The design/plan is the supplied implementation scope for this run. Make sensible internal choices and repair flaws without asking Chris to repeat this request. A genuine missing credential, required human login or unavailable machine may need user input; continue independent implementation while waiting.

## Product outcome

Build a usable Linux browser experience from this fork: sandboxed Chromium with persistent named profiles and shared sign-ins, normal personal browsing, independent agent-owned task tabs, a visible Spaces controller with pause/takeover/resume, a Linux desktop launcher, a relocatable installer, and the existing ego SDK/skills/learnings/plugins. Preserve upstream Mac/Windows behavior and API contracts.

The original native browser application is closed source and absent from this repository. Implement the additive Linux host around `globalThis.ego`; do not spend the run hunting for nonexistent Chromium build sources or claim proprietary UI/engine parity. Keep the full upstream project and original license.

Use `package/ego-linux-host/` for the host and load the existing built SDK. Do not rewrite its drivers or replace it with an unrelated automation library. PR #291 and #202 are pinned reference material, not finished solutions. Adapt useful code with attribution. In particular, replace ephemeral-only profiles, global task selection, context-ID-only authorization and broadcast CDP events.

Shared-profile tasks deliberately share website sessions/storage. Their separation is tab/command ownership. True account separation uses different named profiles. Persistent sign-ins, frame-aware snapshots and human control are required, not stretch goals.

## Working environment and autonomy

- Fork: `https://github.com/BitL8-ByteShort/ego-lite-linux`; `origin` points there, `upstream` to Citro.
- Prepared branch: `feat/linux-desktop`, based on `upstream/dev` at the SHA in `SOURCE-LOCK.json`.
- Use the current branch and preserve the planning/scaffold commits. Check for new user work before edits.
- The original preparation occurred on macOS. Run the actual browser qualification on Linux. Discover available local/remote execution tools and installed Linux environments rather than assuming the current OS is Linux. Use an explicitly available Linux host/VM/container for automated tests. Do not change unrelated services or existing browser profiles.
- A container or Xvfb is useful for real Chromium integration tests but does not prove an actual X11/Wayland desktop. Keep those receipts distinct.
- Do not launch a second implementation session via `start-sol.sh` from inside this run. That script only launched this instruction.
- Keep working through all plan tasks and fix failures. Keep `PROGRESS.md` current, with exact next actions, so context compaction does not restart finished tasks.
- Use focused subagents for independent review or work where helpful. Keep this requested model/effort for implementation delegates if the host supports it; the primary executor remains responsible for integration.

## Completion contract

Complete every acceptance row with evidence. Run the full existing browser E2E through the new launcher's real `--sdk-path` support, not a temporary adapter or selected happy-path cases. Test process restart persistence, two simultaneous agents, shared logins, task routing, hard human pause, dialogs/popups/OOPIFs, native Linux clipboard, clean install/upgrade/uninstall and the packaged agent workflow.

The upstream baseline was tested during preparation; those results are not a substitute for tests after your changes. A unit fixture, fake Chrome transport or hardcoded doctor message never qualifies as a live browser result.

Produce a versioned local Linux artifact, checksum manifest and documented installation command. Commit and push tested work to the user's fork branch. Do not publish a release, merge to upstream, force-push or contact maintainers without a separate request.

If real desktop or native Mac/Windows app access is unavailable, complete the code and every feasible automated gate, then report precisely which live qualification remains unverified. Do not claim completion of an unimplemented core feature or a live test you did not run. Leave the result runnable and a concrete resume command for each external gate.

Start now by checking the branch/status, reading the documents, inspecting the pinned source and identifying the Linux execution environment. Then implement through the final review and handoff.
