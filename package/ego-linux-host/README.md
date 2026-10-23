# ego-linux-host — scaffold

This package is reserved for the Linux implementation described in `../../docs/superpowers/specs/2026-10-23-linux-desktop-design.md` and its implementation plan. It is not a functioning browser yet.

It will own Chromium, persistent profiles, task ownership, the native `globalThis.ego` adapter, a desktop Spaces controller and Linux CLI/installer integration. It will load the existing `../ego-browser/dist/out/index.js` SDK rather than copy its helpers, drivers or site learnings.

The package manifest is intentionally minimal. The implementation adds real build/test commands and dependencies together with working code. Do not add stub methods that report successful browser operations.
