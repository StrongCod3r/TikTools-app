# LIVE resource ownership and memory diagnostics

Audit baseline: `2f8f088c0817b1f5648ebc8222cc67d4e8fc3520` (`remake`).

## Policies implemented

| Resource | Bound and overload policy | Owner and cleanup |
| --- | --- | --- |
| Analytics admission | 1,024 queued records; one batch of at most 128. Admission waits for capacity. No per-event tasks or blocking workers. | AppCore owns one database writer thread and joins it at shutdown. The thread owns its reusable SQLite connection, never AppCore. |
| Analytics failures | Failed transactions retain their batch and retry, applying backpressure. Session admission and disconnect flush each have a 10-second deadline. | Accepted work flushes at shutdown. After the shutdown flush deadline, remaining work is written to a synced recovery file beside the analytics database. Recovery finishes before new admission. |
| Analytics recovery | At most one failed batch plus the bounded queue; serialized recovery has a 16 MiB safety bound. | Batch IDs prevent duplicate counters when recovery committed before file retirement. Successful normal batches retire their IDs; replay IDs retire after the recovery file does. |
| Plugin event delivery | Existing 64-event ordered queue and observable lossy/reliable-gap policy retained. | Observer continuously reaps JoinSet entries, reconciles inactive workers every 250 ms, and fences workers and loader admission to the runtime generation. |
| Plugin calls | 128 admitted calls per running plugin generation, including execution. Overload returns `PluginLoaderError::Overloaded` immediately. | A queued call owns an admission permit until consumption/cleanup. Stopped generations close admission, skip queued calls, and release permits. No extra blocking worker per caller. |
| VM wake notifications | At most one queued wake per VM. | Atomic pending flag clears before pumping. A callback during pumping schedules another wake. Idle native callback delivery remains supported. |
| Speech | One HTTP job in flight, 64 queued jobs. FIFO; full queue rejects new speech with an observable diagnostic rather than restarting the plugin. | One owned worker/runtime. Eligibility stays synchronous; voice lookup, voice selection, deduplication, and speech HTTP run in the worker. Admission timestamps preserve replay windows. Stop cancels HTTP and queued work, then joins the worker. |
| Desktop domain forwarding | Before Winit: 512 lossy snapshots/feed messages; 4,096 reliable messages / 16 MiB. Same classification/coalescing policy as the existing WebView outbox. | One shared mailbox and payload-free wake, with batches of 128. Reliable overflow records a gap and uses the existing fail-loud reload policy. |
| Plugin broker promises | 128 pending requests, 30-second timeout. | Timers clear on response, send failure, page teardown, or disposal. Teardown rejects promises and clears listeners. |
| Native broker tasks | 128 admitted tasks per window, 30-second deadline; oversized requests are rejected before copying/spawning. | Window teardown cancels tasks and closes admission. Window IDs fence responses/subscription effects; randomized request prefixes distinguish reloads. |
| LIVE pump | One owned task. | Shutdown cancellation interrupts receipt/admission, and AppCore joins the task. Broadcast lag records a health gap. |

Plugin call channels retain their existing runtime/ABI plumbing: a call must carry a permit, VM notifications coalesce, and shutdown bypasses admission. Consequently the underlying unbounded channel cannot accumulate unbounded call or wake payloads. Direct synchronous VM compatibility calls are serialized by their mutable instance owner.

The event worker awaits an in-flight loader deadline before exiting. Dropping that future prematurely would bypass process timeout retirement. Ordinary event delivery keeps the five-second deadline; existing first-process-call cold-start grace remains. Foreign native code cannot be forcibly interrupted safely through the existing ABI.

Database transactions fold counters in SQLite without retaining a viewer map. Session opens, samples, counter updates, and closes share the same FIFO writer. Recovery contains aggregate records/viewer identities, never private chat text or session credentials. Failure to write recovery (for example, a full/unwritable disk) is logged with the outstanding count; preservation cannot be guaranteed when storage itself fails. Session admission timeout is also explicit and marks a gap; it does not claim the session row was persisted.

## Safe runtime snapshot

Use the existing control API:

```sh
target/debug/tiktools rpc system.health '{}'
```

Added fields: `liveGeneration`, `automationActiveTasks`, `plugins.eventWorkers`, `plugins.outstandingCalls`, and `analytics` (`capacity`, `batchCapacity`, `queued`, `pending`, `batches`, `failures`, `overload`, `ready`, `stopping`). Existing event-gap, plugin-drop, plugin-health and transport-failure reporting remains available. These counters contain no request payloads, cookies, or chat text.

Opt-in Linux sampling (bounded to 3,600 samples):

```sh
python3 scripts/profile-live-memory.py --pid HOST_PID --samples 300 --interval 1 > memory.csv
```

The sampler reads RSS and process names, traverses children of all host threads, and polls `system.health`. It does not read process command arguments or environment variables. Child classification is heuristic: unidentified child processes appear in `other_child_rss_kib`. Missing health access is reported as `unavailable`; no CLI error payload is logged. Windows process sampling is not implemented.

## Reproducible synthetic regression

```sh
cargo test -p tiktools-core --features persistence,native-tiktok --locked \
  synthetic_canonical_analytics_memory_cycles -- \
  --ignored --nocapture --test-threads=1
```

This opt-in Linux test converts synthetic canonical chat events into analytics records, writes 4,096 records per cycle, joins each writer, checks pending work returns to zero, and verifies exact totals after 24 cycles. After four warmup cycles it allows up to 16 MiB RSS growth for allocator caching. It measures the **test harness process**, not the complete host or a real TikTok connection. The regular suite also tests saturated/locked SQLite, pending shutdown/recovery, idempotent replay, multi-creator totals, 128 plugin restarts with stale generations, concurrent VM wake flooding, cancelled event queues, slow TTS/cancellation, and broker teardown/overflow.

Observed synthetic run: 98,304 canonical chat records, zero pending after every cleanup cycle, 32 transactions per cycle. Warm cycle 3 RSS: 19,240 KiB; cycles 4–23 never exceeded 19,240 KiB; final RSS: 8,060 KiB. There is no equivalent measured baseline run, so these figures are not a before/after leak comparison.

## Remaining validation and limitations

This work does not experimentally establish a real-TikTok leak or full-application steady-state memory stability. Complete the requested ten-scenario matrix on the running application: idle; no/one/multiple plugins; slow TTS; native VM callbacks; reconnects; plugin enable/disable; actual WebView cycles; and sustained storage/plugin overload. Record warm/load/post-cleanup RSS for the host and relevant child processes, together with health counters, and compare against the baseline build.

Native WebView smoke testing requires an actual display and `TIKTOOLS_TEST_NATIVE_WINDOWS=1`; its default test return is a skip, not evidence of GTK/WebView cleanup. Windows compatibility requires the repository CI/build environment. The main Playwright suite was run separately: 3 passed and 36 failed. A representative `globals.list` fake-host failure was reproduced on the unmodified audit baseline in an isolated checkout. Other failures (including widget selectors/screenshots) remain untriaged; the suite is not reported as passing.

The upstream native LIVE transport remains a 512-event broadcast stream. Sustained writer backpressure can make that receiver lag; the host now reports a gap, but missed upstream events are not replayable. Exact writer totals apply to admitted records. Lossless upstream ingestion/durable replay under arbitrarily slow storage remains unresolved.

Native/plugin code already executing can ignore deadlines or block indefinitely. Queued expired/cancelled work is suppressed, but safely interrupting arbitrary in-process foreign code requires cooperative runtime support or process isolation. Complete timeout/rejection/completion/restart metrics, per-plugin event queue depth, and transport byte/backlog diagnostics are not all exposed yet. The mailbox bounds domain forwarding; other proxy producers still need a complete transport-admission audit. These limitations prevent claiming every acceptance criterion in the full audit is closed.

Local validation also passed workspace format/Clippy, 582 workspace Rust tests before the additional observer churn regression, loader all-feature/native integration, 672 scoped frontend unit tests, frontend type-check/lint/build, and the Linux desktop build. Plain `bun test` picks up Playwright files and fails; one repeat crashed the installed Bun canary. Use the repository scoped script for the passing unit suite.
