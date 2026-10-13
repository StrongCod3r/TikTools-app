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


### Batch 3: frontend admission and disposal

- Main control client admits at most 128 pending RPCs, rejects excess with
  `overloaded`, exposes count diagnostics, and rejects calls after detach.
- Feed replay maps belong to the composable instance. Message IDs expire after
  ten minutes; creator/room switching clears them; same-room reconnect keeps them.
- Feed disposal cancels owned frame callbacks, watchers, scroll listeners and
  debounces; debounces now expose a compatible callable `cancel` method.
- Connection RPC completions are fenced by operation/refresh revisions and
  disposal. Topic subscriptions are explicitly released.
- Controller uses the feed's coalesced scroll frame and coalesces gap refreshes;
  gaps during a refresh schedule one further pass rather than unbounded refreshes.
- Validation: 40 focused tests passed, full scoped suite 682 passed; frontend
  type-check, lint and production build passed. Full application mount/WebView
  integration, age-expiry and other composable teardown audits remain outstanding.

Batch 2 commit: `46ac837`.


### Batch 4: connection task failure guard

- A task exit guard marks unexpected completion/panic failed; a closed startup
  response channel also marks failure before returning, avoiding a status race.
- Disconnect domain notification rechecks authority after asynchronous cleanup.
- Validation: all five transport lifecycle tests passed; workspace Clippy passed
  with warnings denied after removing unit-valued send bindings.

Batch 3 commit: `f24e1ea` (updated in the next documentation batch).


### Batch 5: owned bounded LIVE points execution

- One `live-points` OS thread and a 128-job queue replace per-event
  `spawn_blocking` calls and the timeout that abandoned running awards.
- Ingress awaits the award outcome in order. Queue admission is cancellable;
  queued callers already dropped are skipped. Executing synchronous work is not
  forcibly cancelled and is not reported as cancelled by this service.
- Worker retains PointsService only, not AppCore. Explicit shutdown closes
  admission, joins the execution worker and joins the durable writer off Tokio.
- Validation: 128 worker creation/shutdown cycles apply 1,024 exact awards,
  return the PointsService owner count to one after each join, and reject later
  admission. Core feature-enabled library suite: 290 passed, one RSS test ignored.
- This fixes execution ownership, not the unresolved durable writer's sequence,
  synchronous fallback, failure/recovery or dirty-cache correctness defects.
- Extra lifecycle regression covers 32 simultaneous connection requests.
- Upstream EmbeddedSigner owns an internal OS thread without an exposed join
  handle; complete signer teardown verification remains a phase-1 limitation.

Batch 4 commit: `9f1102e`.


### Batch 6: plugin queue accounting

- Per-plugin admission now reserves capacity and records acceptance before
  publishing; consumers cannot take items ahead of their gauge increment.
- Cancelled workers close admission and account for queued payloads they release.
  Saturated-cancellation regression now verifies the queue gauge returns to zero.
- Validation: all 11 plugin queue/fan-out tests passed, including saturated cancellation accounting.

Batch 5 commit: `0653ffe`.
