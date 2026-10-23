# Upstream audit and implementation boundaries

Source inspection refreshed 2026-10-23. Exact revisions are in `SOURCE-LOCK.json`. No Linux product code was implemented during preparation.

## Branch selection

The fork preserves the complete original repository. Implementation starts at `upstream/dev` (`c024c32`), the active SDK and v2.2 guide/plugin line. `main` (`d392204`) and dev have 12 main-only / 50 dev-only commits at inspection. The old `2.0.0-beta-dev` (`b53439c`) is an ancestor of both; dev is 223 commits ahead of it. The contributor paragraph naming the old beta branch is therefore stale for this work. The current dev release rules and freshness checks use dev. Do not reset onto the obsolete beta branch.

Keep the main-only release/readme changes in mind if later synchronizing documentation; do not replace current SDK files with old PR copies. In this fork, `origin` is the user's fork and `upstream` is Citro. Future freshness checks should prefer `upstream/dev` rather than accidentally treating a stale fork `origin/dev` as authoritative.

## What upstream provides

`AGENTS.md` and `docs/native-bindings-api.md` explicitly say the native browser application/bindings are outside this repository. Public source includes:

- `package/ego-browser/src/index.ts`: exported `runMain`, `installEgoSdk`, disposal, embedded/CLI modes.
- `run.ts`: script execution and output/error behavior.
- `browser-runtime.ts`: CDP sessions, child targets, events and dialog state.
- `page-model.ts`, `page-ledger.ts`, `page-ref-registry.ts`, `native-gate.ts`: current Page/TaskSpace semantics and persistent round refs.
- `driver/`, `element-resolver.ts`, `public-api-schema.ts`: browser actions, targeting, validation and help.
- `scripts/render-guide.mjs`: canonical guide generates platform-specific macOS/Windows outputs; Linux must join this mechanism.
- `skills/ego-browser/` and `plugins/ego/`: entry skill, install routing, learnings and all agent adapters.
- `scripts/real-browser-e2e/`: full fixture-backed real-browser suite; existing runner requires a working `nodejs --sdk-path` launcher.

The host belongs at that native boundary, not inside a replacement driver stack.

## Proposal #291

[PR #291](https://github.com/citrolabs/ego-lite/pull/291), `nosliwhtes/ego-lite` at `7bb1545912bf7e7bdf4239a321d36af0e68cb65c`: open, unmerged at review.

Useful source: `package/ego-browser/src/linux/{bridge,launcher,client,host,task-spaces,snapshot-ax,index}.ts` and tests. Preserve the ideas behind owned DevTools pipes, sandbox defaults, private Unix sockets, per-client sessions and epoch revocation.

Required changes:

- `launcher.ts` creates a temporary profile and deletes it; task spaces are ephemeral BrowserContexts. Durable profile paths alone do not make those contexts persistent.
- `client.ts` hashes source/config/display values into host identity. That must not determine durable user profile identity.
- Task/session authorization is not bound to an independent owning agent; target discovery filters by `browserContextId`. That filter leaks all task tabs once tasks share the default context.
- Snapshot implementation captures the main document, uses backend IDs as printed refs and does not supply the complete frame contract.
- CLI support does not implement the existing E2E `--sdk-path` contract. Do not use a temporary test adapter to mask it.
- Its transport test calls Linux-only activation unconditionally and needs a platform-aware test split.
- Its headed smoke launches Xvfb and removes Wayland state. It does not certify a native desktop.
- Linux workflow is not a required dependency of the release job.

## Proposal #202

[PR #202](https://github.com/citrolabs/ego-lite/pull/202), `olenanikita1980-cell/ego-lite` at `27e951b1465b68337366d6a707dd5076b6c78bc9`: draft, unmerged at review. It revives original work by `iagogfe` from PR #134.

Useful source: `package/ego-linux-host/src/{paths,host-control,chrome-supervisor,space-manager}.ts` and persistence/lifecycle tests. Use atomic metadata replacement, profile/runtime separation, owned-process lifecycle and actual cookie/localStorage/IndexedDB restart fixtures as references.

Required changes:

- `SpaceManager.selectedId` is daemon-global, and `useTaskSpace` is asynchronous RPC instead of synchronous invocation-local selection.
- `ego-runtime.ts` permits broad raw CDP paths; `host-daemon.ts` broadcasts CDP events/responses to clients. Replace both with explicit target/session ownership, request routing and revocation.
- Automatic attachment to a browser found on port 9222 is inappropriate for this owned host.
- Persistent CDP IDs are not valid proof of target ownership after a browser restart.
- Missing human controller and same-profile task ownership need implementation.

## Full-project integration risks

The main missing work is the Linux host, not merely an installer guard. Native clipboard supports Mac/Windows in this baseline, so Linux rich paste also needs implementation. Current guide generation, all plugin copies and native error/lifecycle behavior must remain aligned.

Upstream CI packages an SDK ZIP, not a Linux browser installer. Add a relocatable host+SDK payload, desktop files, clean-install tests, update/uninstall preservation and qualification receipts. Do not ship a shim that points into this source checkout.

The SDK build replaces `dist/` and uses `.build.lock`; do not run independent build-triggering commands concurrently in one checkout. The existing E2E runner may skip cases or use a selected subset, so acceptance must inspect the complete case inventory and unexpected skips. On macOS its default resolver prefers the official native CLI; that can give a completely irrelevant “pass” for Linux work.

## Re-fetch references in a new clone

```bash
git remote add upstream https://github.com/citrolabs/ego-lite.git  # only if absent
git fetch upstream main dev
git fetch upstream pull/291/head:refs/remotes/upstream/pr-291
git fetch upstream pull/202/head:refs/remotes/upstream/pr-202
# Verify against SOURCE-LOCK.json. If PR heads moved, inspect pinned commits too.
git show upstream/pr-291:package/ego-browser/src/linux/bridge.ts
git show upstream/pr-202:package/ego-linux-host/src/space-manager.ts
```

Reference sources:

- [Original repository](https://github.com/citrolabs/ego-lite)
- [Native bindings contract](https://github.com/citrolabs/ego-lite/blob/c024c32aa9fb2b4f7ff0524e38e8984bc982db53/docs/native-bindings-api.md)
- [Snapshot contract](https://github.com/citrolabs/ego-lite/blob/c024c32aa9fb2b4f7ff0524e38e8984bc982db53/docs/native-snapshot-ref-requirement.md)
- [Official roadmap](https://lite.ego.app/roadmap) — Linux was planned at original review; do not infer a released native build from the open SDK.
- [Chrome remote debugging profile changes](https://developer.chrome.com/blog/remote-debugging-port) — use a dedicated owned profile.
- [GPT-6.1 Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference) — requested model and `xhigh` project setting.
