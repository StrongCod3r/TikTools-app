# Desktop memory / IPC refactor — Linux evidence and open acceptance gates

Inspected `remake` at `0a494572f6ebb78c8107f2a8a141687e2594f139`.
OS/CPU/WebKitGTK/Wry versions are in `environment.json`. All native measurements
here use Linux X11/XWayland, Wry 0.57.0, WebKitGTK 2.54.1. Windows is untested.
No dependency upgrade is included in the memory refactor.

## Evidence available before changing native teardown

`baseline-observed-live.csv`: 300 samples of an already-running release desktop,
with LIVE connected and plugin workers present. The executable build SHA and
workload control are unknown. Sampling did not change the running user's state.
This is **not** an idle baseline or a reproducible before/after comparison.
Host RSS was 174,648 -> 124,380 KiB; child WebView RSS sum 445,912 -> 171,556 KiB;
threads ended at 63. Existing RSS growth alone was not evidence of a native leak.

`native-smoke.log`: 100 debug native open/close cycles passed (57.62 s), using
alternating direct and deferred closes. `native-smoke-memory.csv` attached too late:
its unavailable rows are retained as a failed sampling attempt, not measurements.

## Reproduced native retention and first teardown A/B

Both release harness runs opened/closed the same plugin page 100 times and kept
GTK pumping for 30 seconds after the final close. Application-owned windows were
zero at every tenth close. They exercise native teardown, not a complete LIVE host.

| Metric | Original IPC signal ownership | Disconnect IPC signal before Wry drop |
| --- | ---: | ---: |
| CSV | `native-release-smoke.csv` | `native-release-after-1.csv` |
| Available samples | 73 | 90 |
| Peak child WebKit RSS sum, KiB | 18,977,412 | 300,908 |
| Final child WebKit RSS sum, KiB | 15,097,512 | 0 |
| Peak child WebKit processes | 200 | 4 |
| Final child WebKit processes | 200 | 0 |
| Peak host RSS, KiB | 224,300 | 184,544 |
| Final host RSS, KiB | 127,324 | 169,820 |
| Final host threads | 338 | 36 |
| Native smoke duration | 85.18 s | 89.73 s |

RSS sums include shared pages. They are **not** unique physical memory totals.
The host RSS did not improve after cleanup, so no general Rust-heap fix is claimed.
The original sampler was delayed under native resource pressure; compare elapsed
seconds, not sample indices. Health is unavailable for these isolated test hosts.

Source inspection found Wry 0.57's `attach_ipc_handler` captures a strong GTK
WebView in the content manager's signal closure; that WebView owns the manager.
The measured A/B supports retiring this signal at terminal teardown. Unregistering
an IPC name alone leaves signal handlers connected:
[WebKit UserContentManager](https://webkitgtk.org/reference/webkit2gtk/stable/class.UserContentManager.html).
The implementation finds/disconnects the specific signal handlers using GObject's
supported APIs, keeping the content manager alive throughout and preserving the
native destroy sequence. See [GObject signal ownership](https://docs.gtk.org/gobject/signals.html).
No upstream issue has been submitted; broader runtime/version/platform reproduction
remains required before attributing every WebView retention symptom to this cycle.

Prototype native binaries were built from the inspected SHA plus the working
changes, before the final implementation commit. Their build SHA is consequently
labelled `0a494572-plus-working-tree`; repeat runs of the committed binary were skipped at the user’s request. Do not relabel prototype binaries as exact final-commit builds.

## Producer audit / finite budgets

| Producer / command | Ownership and admission | Remaining limitation |
| --- | --- | --- |
| Legacy HostEmitter, main RPC replies, domain events | One shared bounded mailbox before Winit; one payload-free pending wake | Producer prepares classification, routing and escaped script literals; UI drains bounded prepared items |
| Main WebView requests | 128 permits acquired before payload copy/task spawn; existing byte limit | Deadline retains permit until irreversible work finishes; foreign work may never cooperate |
| Main plugin open/close commands | Carry main inbound permit through Winit consumption | No correlated result exists in the legacy open/close notification protocol |
| Native broker reply/subscription | Response and subscription effect share one admitted command; 128 permits/window; 1 MiB replies; window ID + page generation | Oversized/overloaded native inbound calls still rely on existing JS timeout; no host terminal-status API |
| Frontend readiness | Coalesced wake and latest page generation | Wry page-start callbacks differ in timing between platforms; Windows exercise required |
| Domain/UI flush wakes | Payload-free, pending mailbox flag and bounded per-tick drain | Main/plugin outbox chaining can post a second finite wake per tick |
| Deferred plugin close | Once per closing window; native window ID and owner token fence replacement | External-destroy path intentionally retains the dead native Window handle |
| Tray commands | Small payload-free user actions | Coalesced pending signals; latest visibility intent retained |
| Single-instance ShowWindow | Serial local listener, payload-free | Repeated activation coalesces before Winit admission |
| IpcFailed / ShutdownComplete | One host-owned retry task (5 s) / one shutdown | Coalesced signals; failure diagnostic truncated to 4 KiB |

| Resource | Old | New |
| --- | --- | --- |
| Reliable mailbox / main outbox | 4,096 / 16 MiB, overflowing item retained before failure | Hard 4,096 / 16 MiB; reject overflowing item and fail/reload |
| Lossy mailbox / main outbox | 512, no byte limit | 512 / 8 MiB; measured drops and gap/resync |
| Serialized outbound item | No independent bound | 1 MiB raw JSON, bounded serializer; escaped literal and metadata also count toward queue budgets |
| Batch | 128 items, no byte cap | 128 / 4 MiB |
| Main inbound tasks | No host semaphore | 128, 30 s uncertain-completion deadline |
| Native broker Winit replies | Execution-only permits | Permits remain held through queued response/effect consumption |
| Native plugin output | Per-message evaluation | Reliable bounded buffer; four round-robin windows per tick, one batch/window |
| Native plugin windows | No manager cap | 32 |
| Inline broker calls | No admission / deadline | 128; 30 s deadline, admission retained until backend settlement |

## Validation and remaining work

Validation logs are stored beside this report. The final cleanup results and deliberately skipped measurements are recorded below. Initial Rust all-feature/test compilation
failed because the signer revision at HEAD added `GiftEvent.gift_image_url` and
four `FieldSchema` fields while fixtures still constructed the old shapes. Those
fixtures were aligned without changing runtime behavior. Initial stricter-budget
unit assertions and Clippy issues were corrected before final validation.

The 100k paused-UI test uses four concurrent feed producers plus 100 reliable replies:
512 feed items retained, exactly 99,488 shed, all reliable replies retained in FIFO.
The byte stress tests cover candidate/item and batch bounds. Permit tests cover
queued native commands and cancellation. Frontend tests exercise 100 feature
mount/dispose cycles and late picker/RPC completion; these are **not** 100 complete
Vue-root mounts or navigation across every view. PluginFrame already disposes hosts
on prop changes and unregisters its message listener; iframe keys now give changed
plugin/source documents separate WindowProxy identities. Live's 300-visible /
900-staged feed policy is unchanged.

The user explicitly requested ending the task and skipping complicated tests. Remaining
controlled release idle/LIVE/plugin/tray/reconnect/slow-storage/TTS matrices, repeated
release runs, Windows execution, JS heap snapshots, full-root/all-view navigation,
external destroy/display loss, and final-source native integration reruns were skipped.
No universal memory slope or latency budget is established.

Production main transport now retains one bounded batch until a generation/sequence
ACK after JavaScript dispatch. It waits for readiness; evaluate failure or a missing
ACK after five seconds retires the transport and reloads/resyncs. This establishes
bridge dispatch, not completion of every application-side asynchronous effect.
The earlier debug main RPC smoke exercised five forced reloads and five completed
1,002-request floods: 1,369 admission rejects, 50 evaluations, zero evaluation errors,
and all 128 permits recovered. Completed-cycle p95/p99 ranged 960–973 ms. The native
1,000-envelope prototype used nine evaluations, 72,060 script bytes and zero errors.
These measurements precede the final prepared-envelope changes.

Final cleanup: desktop unit run reports 71 passed, zero failed (two opt-in GUI tests
return without exercising GUI); focused frontend run reports 29 passed, zero failed;
TypeScript and ESLint passed. Earlier full workspace/frontend/Clippy and native runs
are retained as earlier-source evidence, not claimed as final-source full validation.

| File / group | Change | Test | Measured result / limit |
| --- | --- | --- | --- |
| `scripts/profile-live-memory*.py`, profiler tests | Linux/Windows host attribution and aggregate CSV diagnostics | Nine profiler tests previously passed | Windows runtime untested; RSS sums include shared pages |
| `event.rs`, `window/{outbox,ipc,lifecycle}.rs`, core health | Pre-Winit admission, 128 inbound permits, generation fences, ACK/recovery, prepared payloads | Final desktop unit suite | 100k paused-UI stress: 99,488 eligible drops; bounded queues |
| `plugin_webview/{mod,smoke}.rs`, `platform.rs` | Bounded native batching and terminal IPC signal cleanup | Earlier real Linux native A/B and delivery smoke | 100 cycles: final child count 200 → 0; 1k messages: nine evaluations |
| Frontend features/controller/client and plugin UI | Owned disposers, stale-result fences, cancellation, broker caps | Final 29 focused tests, TypeScript, ESLint | 100 feature disposal cycles; no JS heap measurement |
| Core test fixtures | Align pinned signer schema | Earlier workspace tests | Compile regression repaired; runtime unchanged |
| Benchmark report/CSV/plot | Preserve attributed evidence and limitations | Log review | One prototype A/B; no final-commit or Windows comparison |

Points/storage/plugin/LIVE follow-up is covered by the current HEAD's existing
ownership/FIFO/recovery work and regression suites. This change does not claim to
solve uncooperative in-process native code or the signer's missing OS-thread join.

## Separate PR #20 verdict

Initially queried head `aeb3e0109c62e022d133416e87cc58cc2447742e`; the PR changed
while this review was running. Fetched/tested latest head
`4f7a23c911e650ef32d0004d6576ceaf442eba7a`, whose parent is the inspected `remake`
SHA. GitHub reported OPEN / CLEAN / MERGEABLE; no checks were reported at the first
query. The isolated checkout merge check reported already up to date. The current
proposal actually resolves ZIP **9.0.3**, Tokio **1.53.3**, rather than the versions
in the original specification.

**Do not merge as-is.** Linux installer compilation fails at `installer.rs:64`,
`:145`, `:153`: `ZipFile::name()` now returns `Result<Cow<str>, ZipError>`. Packager
test compilation also fails where archive names call `.to_owned()` directly.
Logs: `pr20-installer.log`, `pr20-pack.log`, `pr20-workspace.log`. Extraction,
traversal, symlink, duplicate-path, size/bomb, executable-mode, checksum and rollback
regressions on ZIP 9 are **blocked by compilation**, not passing. Windows/all-feature
upgrade behavior is untested. The isolated worktree is `/tmp/tiktools-pr20-review`;
no dependency changes were applied to `remake`, no PR comments or merges were sent.
