# Host modules

`cli` and `ego-client` adapt invocation-local native bindings to the unchanged SDK. `host-control` launches the per-profile daemon under a kernel `flock`; `host-daemon` owns private RPC, metadata and Chromium. `paths` enforces managed directory permissions and atomic state. `cdp-bridge` owns the private pipe.

`task-registry` owns capabilities, epochs and leases. `host` authorizes target/session lineage, scopes responses/events and gives human control priority; `cdp-policy` inventories exact permitted methods and rejects unsafe embedded authority IDs. `downloads` maps verified download frames to task staging without changing personal download behavior. `snapshot-engine` handles AX/DOM frame topology and renderer-local refs. `desktop-server` serves only authenticated local controller assets.

Behavior tests are colocated; real browser, lifecycle, control and installation gates live in `scripts`. Raw receipts are ignored under `artifacts/linux`. See `docs/linux/VERIFICATION.md` for observed evidence, not just configured capabilities.
