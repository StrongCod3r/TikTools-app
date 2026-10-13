# LIVE reliability refactor progress

Target: `remake`. Baseline and fetched target: `79dd1ab193cf7e8e251575d44e0a6270f7814010`.
Feature branch: `fix/live-reliability-refactor`. Work in progress; no acceptance criterion is assumed complete.

## Current implementation audit

The transport, core lifecycle/ingress/handlers, points writer/SQLite,
analytics writer, plugin manager/workers/process/VM, fan-out/supervision,
poll/push runtime, frontend connection/feed/control/controller, desktop
outbox/lifecycle, existing tests and performance documentation were inspected.
Existing bounded queues, replay guards and compatibility interfaces must remain.

| Phase | Confirmed findings / remaining work | Status |
| --- | --- | --- |
| 1 | Native initialization occurs outside ownership control; task handles are discarded. Core assigns generation at processing time. Lifecycle notifications are unfenced. Service connected flag survives unexpected termination. | Pending |
| 2 | Ingress publication precedes gauge increment; consumer can underflow it. Cancellation leaves queued gauge nonzero. Per-event points blocking work can continue after a timeout. Payload count is bounded, decoded payload size is not proven bounded. | In progress |
| 3 | Sequence allocation and submission can reorder. Synchronous fallback overtakes FIFO writes. Failed transactions still advance committed sequence; shutdown sets it to MAX regardless of outcome. Full resets clear dirty markers prematurely. | Pending |
| 4 | Failed workers lose join ownership. Stop can join indefinitely. Startup handshake has no deadline. Process per-call I/O threads are detached. Replacement can race old stop's running flag. | Pending |
| 5 | Exact plus match-all indexes duplicate a subscriber; repeated exact patterns also duplicate. Polling awaits inside pushed-event receive loop. | Pending |
| 6 | RPC pending map has no count bound. Feed dedup maps are global and IDs have no age expiry. Debounces cannot cancel. Async connection results have no request fencing. Controller adds an unowned animation callback. Gap refreshes can storm. | Pending |
| 7 | Existing diagnostics/profile coverage needs extending; old measurements are historical, not evidence for this branch. | Pending |
| 8 | Full checks, synthetic comparisons and suitable real-LIVE/display validation remain required. | Pending |

## Evidence and validation

Findings above are static code findings. No new benchmark results or real-LIVE
memory measurements have been collected. No real memory leak is claimed fixed.
Git working tree was clean before branch creation. No repository AGENTS.md was found.

## Completed batches

### Batch 1: transport ownership and ingress generation/accounting

- Added an owned connection task, cancellation token, monotonically increasing
  transport generations and an additive stamped stream; legacy `subscribe`
  and connect/disconnect interfaces remain available.
- Connect and pick supersede initialization; replacement joins the old task.
  Five-second teardown failure retains ownership and refuses replacements.
  Network initialization has a 60-second deadline; socket close has three seconds.
  Embedded signer construction is joined rather than abandoned on cancellation.
- Core consumes original generations, fences stale lifecycle and data items,
  and publishes lifecycle topics from the ordered worker rather than duplicating
  them in RPC handling. Connection status reads transport state.
- Admission reserves capacity and accounts before publication. Shutdown counts
  cancelled queued payloads explicitly. Removed the unsupported byte-bound claim.
- Validation: transport unit suite passed (4 tests); core feature-enabled library
  suite passed (288 passed, one opt-in RSS test ignored). Includes 100,000 concurrent
  admissions, full-queue cancellation and stale disconnect regression.
- Remaining phase-1 work: upstream reconnect-in-progress state is opaque to this
  adapter; `Reconnecting` is represented but cannot yet reflect each upstream
  retry. Additional real transport concurrency/termination validation is required.
- This is synthetic/static validation; no real-LIVE memory evidence was collected.

Later batches are in progress and not covered by this commit's completion record.


### Batch 2: fan-out and polling isolation

- Fixed exact/repeated/wildcard/match-all overlap by returning a subscriber set.
- Polling and pushed events have independently owned tasks, with bounded existing
  broadcast admission and explicit lag-gap reporting. Shutdown joins both tasks.
- Regression: a real fixture worker holds a poll open while a pushed event must
  reach the domain bus within 500 ms, then both owners are joined.
- Validation: 11 plugin-event tests passed; the slow-poll isolation regression passed.
- Not complete: startup can still block a Tokio caller; pushed-event processing
  itself can wait on automation; generation/queue metrics need further work.

Batch 1 commit: `4c3cb3e`. Later lifecycle crash handling is separately tested
(5 transport tests passed); no real-LIVE measurements have been collected.
