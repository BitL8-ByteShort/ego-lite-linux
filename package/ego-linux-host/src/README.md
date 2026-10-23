# Planned module responsibilities

The implementation plan owns the exact interfaces. Source and behavior tests belong together here, matching upstream ESM TypeScript conventions.

- `cli.ts`, `ego-client.ts`, `protocol.ts`: installed CLI, SDK adapter and versioned local RPC.
- `host-daemon.ts`, `host-control.ts`, `paths.ts`: lifecycle, discovery and XDG paths.
- `chrome-supervisor.ts`, `cdp-bridge.ts`, `profiles.ts`: owned Chromium pipe and durable named profiles.
- `task-registry.ts`, `leases.ts`, `target-registry.ts`: stable task identity and revocable operational ownership.
- `cdp-policy.ts`, `session-router.ts`: method/parameter authorization and isolated response/event routing.
- `snapshot-engine.ts`: frame-aware AX snapshots compatible with upstream refs.
- `desktop-server.ts`, `desktop/`: authenticated local Spaces controller.

Reuse attributed pieces from the pinned proposals after adapting their contracts. Neither prior proposal is correct unchanged for shared persistent profiles and parallel agents.
