# ego lite on Linux — implementation handoff

This is a fork of the **complete** `citrolabs/ego-lite` repository. The Linux work is additive and keeps the upstream SDK, API, skills, learnings, plugin adapters, licensing and platform support.

## Start one implementation run

Use **GPT-6.1 Sol** with **Very high / Extra high (`xhigh`)** reasoning.

```bash
./scripts/linux/start-sol.sh
```

The script opens Codex in this checkout and supplies `docs/linux/SOL-ONE-SHOT.md` as the initial prompt. It explicitly selects `gpt-6.1-sol` and `model_reasoning_effort="xhigh"`; it does not change global settings or bypass permission controls. Check the launcher without starting a model with `./scripts/linux/start-sol.sh --check`.

In the desktop app, open this folder as a project, select the same model/reasoning, and send: **Read `docs/linux/SOL-ONE-SHOT.md` and execute it to completion.**

## Read in this order

1. `AGENTS.md` and `CONTRIBUTING.md` — upstream conventions.
2. `docs/linux/SOL-ONE-SHOT.md` — execution instruction and completion contract.
3. `docs/superpowers/specs/2026-10-23-linux-desktop-design.md` — product and architecture decisions.
4. `docs/superpowers/plans/2026-10-23-linux-desktop.md` — ordered, testable implementation tasks.
5. `docs/linux/ACCEPTANCE.md` — requirements and required evidence.
6. `docs/linux/UPSTREAM-AUDIT.md` and `docs/linux/SOURCE-LOCK.json` — pinned source and reuse decisions.

## What is prepared

- GitHub fork: https://github.com/BitL8-ByteShort/ego-lite-linux
- Local project: `/Users/chris/Projects/ego-lite-linux`
- Working branch: `feat/linux-desktop`, based on upstream `dev` at `c024c32aa9fb2b4f7ff0524e38e8984bc982db53`.
- `origin` is the fork; `upstream` is `citrolabs/ego-lite`.
- Prior proposals are available locally as `upstream/pr-291` and `upstream/pr-202` for source inspection, without merging them.
- `package/ego-linux-host/` is an explicitly unfinished host scaffold. Sol implements it.
- The original browser SDK dependencies are installed locally. See `docs/linux/PROGRESS.md` for actual baseline results.

The deliverable is a usable Linux browser experience: persistent Chromium profiles, shared sign-ins, agent task tabs, a visible Spaces controller, human takeover, an installable launcher, and upstream-compatible automation. The proprietary Citro browser UI/engine is absent from upstream; this project supplies a Linux host for the open SDK and does not claim to rebuild that proprietary app.

This handoff is prepared for one sustained implementation run. It is not a claim that the Linux product is already implemented or that any model can guarantee completion in a fixed number of tokens.
