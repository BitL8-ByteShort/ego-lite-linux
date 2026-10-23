# Native binding contract matrix

The owning references are `docs/native-bindings-api.md`, `native-snapshot-ref-requirement.md` and the unchanged SDK public schema.

| Binding                                      | Host implementation                                                                             | Evidence                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| synchronous useTaskSpace                     | ego-client local numeric selection, captured per outgoing operation                             | adapter and cross-space browser tests                                |
| listProfiles / createTaskSpace profile       | selected named daemon profile; other profiles selected by CLI --profile                         | profile selection browser case; separate-profile persistence fixture |
| list/create/claim/close/complete task spaces | logical metadata, stable workflow owner, private capabilities and epochs                        | registry and authority tests; full browser task lifecycle            |
| handOff/takeOver/completion checks           | delegated ownership distinct from hard pause; human UI resumes hard pauses                      | control fixture and delegation regression                            |
| listTabs/createTab                           | registered targets only, default-context shared login, independent background windows           | ownership tests; real two-agent fixture                              |
| snapshot                                     | AX/DOM with frame and backend provenance, scoped capture, unique ref IDs                        | snapshot/lineage tests; full browser frame cases                     |
| sendCDPMessage/callbacks                     | request IDs translated by owned pipe; callbacks only to issuing client; events epoch filtered   | bridge, ownership, pause tests and browser suite                     |
| setAgentTaskState                            | persistent UI state; failures populate lastError                                                | controller/task registry tests                                       |
| animationHighlightMouseToPosition            | explicit unsupported error; no physical pointer automation                                      | documented optional UI limitation                                    |
| getBrowserVersion                            | factual installed Chromium product; no updater                                                  | launcher/doctor and browser version receipts                         |
| disposal                                     | SDK callbacks, RPC clients, sessions and pending calls released; daemon persists between rounds | cross-round and lifecycle fixtures                                   |

Native policy errors retain `error_code`; raw Chromium protocol errors retain numeric CDP `code` and per-request identity. Invalid native arguments throw `TypeError` with `EGO_INVALID_ARGUMENT`. Regular native methods resolve documented error objects; snapshot rejects. No supplied native binding is replaced when loading the SDK.

Task IDs and names locate state; they do not authorize it. User-created tasks require an explicit controller grant. Every task request carries client identity, owner, capability, epoch and browser generation. The capability system prevents accidental cross-task commands; arbitrary scripts running under the same OS user are not an operating-system security boundary.
