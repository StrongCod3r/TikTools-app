# Native LIVE projection / renderer diagnostic pilots

These are **short synthetic diagnostic probes**, not the final A–J performance
gate and not real TikTok LIVE. Phases were 3 s idle, 10 s load, 3 s cleanup, at
1,000 deterministic mixed events/s through actual core ingress, persistence,
automation, main desktop IPC and compiled Vue/Wry. Renderer memory is process
RSS, not retained JS/native heap. PSS/USS sampling is also recorded where allowed.

## Confirmed same-artifact renderer A/B

Both row-blur runs used exactly the same native release test executable:
`d8cd0e7ed3a6b412354a1709d020bd73cffb3fac76564e32d5c457a63bb2c92d`
(SHA-256). Their asset manifests are identical; the SHA-256 of sorted JSON asset
hashes is `85de385b1e2ab833a3090e0b1cb8941dff005c212818c5b68383f4496da25331`.
Source identity is HEAD `01e6277d8c28cec5e9363ef8297efb76059323ea` plus the
recorded dirty patch/source additions, **not a clean candidate commit SHA**.

Only the test-only `--disable-row-blur` switch differed: it injected
`.tt-badge-level { backdrop-filter:none; -webkit-backdrop-filter:none }`.

| Variant | Renderer RSS near 14 s | Process-tree USS near 14 s |
|---|---:|---:|
| Original per-row blur | 3,982,036 KiB | 3,934,252 KiB |
| Blur disabled | 488,488 KiB | 435,016 KiB |

The disabled run retained the same 300-row feed and image-enabled workload.
An earlier image-disabled pilot still reached approximately 3.9 GiB renderer
RSS. This isolates the per-row filter as a major contributor in this native
Linux setup. The implementation removes that filter. It does not classify its
allocations as a leak without retained-object/native allocator evidence.

Raw A/B records: `row-blur-*.ndjson`, `row-blur-*-memory.ndjson`,
`row-blur-*-manifest.json`, and `row-blur-memory.csv`.
The source-addition copies and patches are preserved in the original `/tmp`
runner output directories during this session; manifests hash them. The native
executable and diagnostic assets are build outputs, not committed artifacts.

## Other discoveries and scope

- The initial actual main-page probe stopped at one feed commit with 900 staged
  entries, while both presentation visibility checks remained enabled. The
  rAF/timeout fallback subsequently reached 300 visible rows and drained staging.
- Native 10k points regression retains all requested individual domain awards
  and exact absolute totals while the main page receives timed top-K snapshots.
- Native 10k action completion regression preserves all completions and the
  exact final 60-item history without per-action main-page history lists.
- Settings pilot received no feed messages and committed zero feed updates;
  it counted all 10,000 suspended events.
- Chromium 100-root test captures three heap snapshots and returns active
  subscriptions/timers/DOM to baseline. Intermediate snapshots contain old
  closures behind conditional WeakMap/ephemeron entries; the final snapshot
  returns to one receive/feed/points instance. These are not native renderer
  heap snapshots and cannot prove Windows or WebKit retention behavior.
- Existing backend automation overload is observable: some synthetic chat/
  points-awarded automation work was rejected by the existing 32-slot policy.
  The tests do not conceal those counters or claim all source events execute
  workflows. Dedicated 10k admitted action tests verify visualization does not
  drop/duplicate execution. The final correctness gate must assess overload
  separately, including durable gift/follow workflows and slow TTS.

Earlier `*-pilot` / frame probes ran intermediate candidates and are diagnostic
records, **not controlled before/after throughput comparisons**. Their manifests
or source hashes document the available identity. The Settings memory wrapper
initially mislabeled child RSS fields; those fields have been omitted from the
committed pilot samples. Host RSS and PSS/USS were unaffected. The current runner
uses corrected child labels and explicit renderer process counts.

## Still required

Full comparable release baseline/candidate A–J matrices on Linux and Windows,
>=10-minute load / >=2-minute cleanup, 30-minute DOM/image stability, actual
reconnect/plugin-frame lifecycle tests, WebKit/WebView2 heap
or allocator retention evidence, and real TikTok LIVE. No universal performance
threshold or all-platform leak-free claim follows from these pilots.


## DOM count and actual native reload checks

The same-artifact 30-second C workload with a diagnostic 100-card render limit
versus 300 cards recorded about 1,807 versus 5,027 DOM nodes. Median sampled
rAF interval p95 during load was 102 versus 155 ms. This is callback interval
telemetry, not a GPU frame-time measurement. Both received all 30,000 source UI
events. Raw records/manifests are `dom-100*` and `dom-300*`.
Pinned rendering now defaults to 100, retaining the 300-event buffer and exposing
all buffered rows for pause/search/filter. Browser regressions verify autoscroll,
paused position across navigation and searching an older buffered event.

The isolated actual native reload workload completed 100 reloads and 110,000
synthetic events, ending at generation 101 with zero script-evaluation errors.
Raw records are `native-reload-100*`. Real reconnects, plugin cycles and Windows
remain separate outstanding checks.

## Completed 30-minute native Feed workload

The release native C run completed 30 seconds of warmup, 1,800 seconds at
1,000 synthetic events/s, and 120 seconds of cleanup. All 1,800,000 source
events reached the frontend; feed presentation drops, ingress drops, reliable
gaps, script evaluation errors and reloads were zero. Generation remained 1.
Points persistence applied and committed all 1,800,000 awards with no write
errors. Automation reported 65,093 admission rejections under the existing
bounded concurrency policy; this run does not establish lossless automation
under overload.

Final UI counts were 100 rendered rows, 300 buffered events, zero staged events,
1,808 DOM nodes and 114 images. Two renderer processes remained throughout
steady load and cleanup. Renderer RSS was 547 MiB near the middle and 605 MiB
at the end of cleanup; final tree USS was 538 MiB. These samples alone do not
prove a retained leak or a memory plateau. Sampled rAF interval p95 was about
102 ms under load and 17 ms at the end of cleanup: responsiveness at this
rate still needs improvement. WebKit did not expose JS heap or long-task data.

Raw samples and exact executable/assets/dirty-source identity are preserved in
`feed-30min-host-ui.ndjson`, `feed-30min-process-memory.ndjson` and
`feed-30min-manifest.json`. This is synthetic Linux evidence, not real LIVE,
a clean-commit comparison or Windows validation.


## Additional lifecycle verification

The candidate native release test completed 100 plugin window open/close
cycles, delivering 100 ordered broker events in each window (10,000 total).
The real Wry/GTK broker round-trip and disposal assertions passed; owned window
count returned to zero after every cycle, with zero evaluation errors. Command:

```bash
TIKTOOLS_TEST_NATIVE_WINDOWS=1 TIKTOOLS_NATIVE_SMOKE_CYCLES=100 \
TIKTOOLS_NATIVE_SMOKE_MESSAGES=100 \
target/release/deps/tiktools_desktop-3540f015ea8dcec8 \
plugin_webview::smoke::native_open_close_cycles --nocapture
```

This is a native lifecycle/delivery check, not a simultaneous LIVE/plugin memory
profile. Chromium browser regressions also passed 100 actual Vue root remounts
(with three heap snapshots) and 100 Feed↔Plugins navigation cycles. Navigation
now waits for each view's DOM to mount, so the switches exercise the views
rather than collapsing into one Vue tick. Final subscription counts, timers,
frame handles and DOM counts returned to baseline. Browser/fake-host evidence
does not replace WebKit/WebView2 retained-object inspection.
