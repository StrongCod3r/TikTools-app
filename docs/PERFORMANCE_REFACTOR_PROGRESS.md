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
| 1 | Transport task ownership, original stamping and stale fencing implemented. Upstream reconnect visibility and signer OS-thread teardown remain. | Partial |
| 2 | Queue accounting and bounded owned points execution implemented. Payload-byte limits, expensive logging and complete pipeline stress validation remain. | Partial |
| 3 | Sequence allocation and submission can reorder. Synchronous fallback overtakes FIFO writes. Failed transactions still advance committed sequence; shutdown sets it to MAX regardless of outcome. Full resets clear dirty markers prematurely. | Pending |
| 4 | Failed workers lose join ownership. Stop can join indefinitely. Startup handshake has no deadline. Process per-call I/O threads are detached. Replacement can race old stop's running flag. | Pending |
| 5 | Subscriber uniqueness, separate poll/push owners and gauge cleanup implemented. Poll generation/metrics and pushed processing isolation remain. | Partial |
| 6 | Main RPC bounds, feed ownership, scoped/aged dedup, debounce cancellation and stale response fences implemented. Full composable/WebView/performance audit remains. | Partial |
| 7 | Profiler thread/CPU/state labels and measured primitive comparisons added. Full host/child/scenario matrix remains unavailable. | Partial |
| 8 | Rust/frontend checks and native smoke passed; Playwright 3 passed/36 failed. Real-LIVE testing and remaining implementation verification are not complete. | Partial |

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


### Batch 7: measurement and verification record

- Profiler accepts build/workload labels and idle/load/cleanup phase labels;
  samples host CPU/threads and connection generation/state, treats missing RSS
  as unknown, and rejects mismatched health PID. Three Python regressions passed.
- Identical sequential PointsService microbenchmark commands were run on exact
  baseline `79dd1ab` and candidate. Raw sanitized data is checked in under
  `docs/benchmarks/live-refactor-2026-10-13.json`. No throughput improvement claim.
- Analytics-only Linux RSS test: 24 cycles, 98,304 records, 32 batches per cycle,
  zero pending after each join; RSS 19,784 KiB from cycle 1 through cycle 23.
- Frontend: 682 scoped unit tests passed; type-check, lint and build passed.
- Rust: format and workspace Clippy with warnings denied passed; workspace tests,
  core persistence/native tests, throughput tests, loader all-feature tests and
  analytics RSS opt-in test passed. Final rerun results are recorded below.
- Native WebView smoke test was enabled and passed on the configured display.
- Playwright: 3 passed, 36 failed. `navigation.spec.ts` boot failure from an
  unhandled `globals.list` was reproduced on exact `79dd1ab` in an isolated
  checkout. Other failures remain untriaged, not classified as pre-existing.
- No suitable authenticated real-LIVE session was used. Real-LIVE, full-host
  idle/peak/cleanup and child/thread comparisons have not been measured.
- Full refactor is not done: phase 3 durable points and phase 4 plugin lifecycle
  are still unimplemented, plus the partial phase limitations in the table.

Batch 6 commit: `9a656f0`.
Single draft PR: https://github.com/nglmercer/TikTools-app/pull/19


### Additional frontend regressions

Replay-age expiry and out-of-order concurrent status refreshes now have explicit
regressions. Final scoped frontend suite: **684 passed**, zero failed;
frontend type-check and lint passed. Earlier 682/40 counts are historical runs.

### Final Rust rerun on the implemented batches

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed |
| `cargo test --workspace --locked` | Passed; opt-in analytics RSS test ignored here |
| `cargo test -p tiktools-core --features persistence,native-tiktok --locked` | 290 library tests + 8 throughput tests passed; one RSS test ignored here |
| Explicit opt-in analytics RSS test | Passed separately, 24 cycles |
| Plugin-loader `--all-features --locked` tests | Passed |
| Native WebView smoke with gate enabled | Passed on configured display |
| Main Playwright suite | **Failed: 36 failed, 3 passed** |
| Python profiler regressions | 3 passed |

The outstanding phase-3/phase-4 work is an implementation gap, not an environment
blocker. This draft must not be described as meeting the full definition of done.
