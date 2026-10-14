#!/usr/bin/env python3
"""Run one isolated actual Wry/Vue synthetic case and record host/child memory.
Build diagnostic assets and the native test binary first (see --help).
Never connects to TikTok; never equates RSS with retained heap.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]


def build_identity():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    changes = subprocess.check_output(['git', 'diff', '--binary', 'HEAD'], cwd=ROOT)
    return revision, changes


def memory_sample(profiler, pid):
    if profiler.WINDOWS:
        tree, truncated = profiler.windows_snapshot(pid, profiler.windows_processes())
        return {'kind': 'rss-sum-shared-pages', 'rssKib': sum(p['rss'] for p in tree.values()),
                'processes': len(tree), 'truncated': truncated}
    rss = profiler.descendants(pid)
    processes = [pid]
    seen = set()
    pss = uss = renderer_count = 0
    unavailable = False
    while processes and len(seen) < 256:
        current = processes.pop()
        if current in seen:
            continue
        seen.add(current)
        sample = profiler.process_sample(current)
        if sample is None:
            continue
        if current != pid and ('webkit' in sample[1] or 'webview' in sample[1]):
            renderer_count += 1
        processes.extend(child for child in sample[2] if profiler.belongs_to_parent(child, current))
        try:
            values = {}
            for line in (pathlib.Path('/proc') / str(current) / 'smaps_rollup').read_text().splitlines():
                key, _, value = line.partition(':')
                if key in ('Pss', 'Private_Clean', 'Private_Dirty'):
                    values[key] = int(value.split()[0])
            pss += values.get('Pss', 0)
            uss += values.get('Private_Clean', 0) + values.get('Private_Dirty', 0)
        except (OSError, ValueError):
            unavailable = True
    threads, cpu_ticks = profiler.host_activity(pid)
    return {'hostRssKib': rss[0], 'pluginRssKib': rss[1], 'rendererRssKib': rss[2], 'otherChildrenRssKib': rss[3],
            'rendererProcesses': renderer_count, 'treePssKib': None if unavailable else pss,
            'treeUssKib': None if unavailable else uss, 'processes': len(seen),
            'hostThreads': threads, 'hostCpuTicks': cpu_ticks, 'truncated': rss[4]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog='Build: VITE_TIKTOOLS_DIAGNOSTICS=1 bun run build:web; cargo test -p tiktools-desktop --release --features live-benchmark --no-run. Pass the emitted test executable via --binary. Run each case in its own process.')
    parser.add_argument('--binary', type=pathlib.Path, required=True)
    parser.add_argument('--case', choices=list('ABCDEFGHJ'), required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--warmup', type=int, default=30)
    parser.add_argument('--load', type=int, default=600)
    parser.add_argument('--cleanup', type=int, default=120)
    parser.add_argument('--rate', type=int, default=1000)
    parser.add_argument('--row-limit', type=int, choices=[0,50,100,300], default=0, help='diagnostic DOM-count override; 0 uses the production default')
    parser.add_argument('--lifecycle', choices=['root', 'reload'], default='root', help='100-cycle mode for case J')
    parser.add_argument('--disable-row-blur', action='store_true', help='diagnostic A/B for per-card compositor filters')
    args = parser.parse_args()
    if not (1 <= args.warmup <= 600 and 1 <= args.load <= 1800 and 1 <= args.cleanup <= 600):
        parser.error('phase durations must be positive and bounded')
    if not (10 <= args.rate <= 10000 and args.rate % 10 == 0):
        parser.error('rate must be a multiple of 10 between 10 and 10000')
    args.output.mkdir(parents=True, exist_ok=False)
    revision, patch = build_identity()
    # Record all tracked dirty changes and hashes of harness/asset inputs.
    (args.output / 'candidate.patch').write_bytes(patch)
    identity = revision if not patch else f'{revision}+patch-sha256:{hashlib.sha256(patch).hexdigest()}'
    additions = {}
    for raw in subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=ROOT).split(b'\0'):
        if not raw:
            continue
        name = os.fsdecode(raw)
        if pathlib.Path(name).parts[0] not in ('crates', 'scripts', 'src', 'tests'):
            continue
        path = ROOT / name
        if path.is_file():
            additions[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            dest = args.output / 'source-additions' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
    manifest = {'revision': revision, 'sourceAdditions': additions, 'dirtyPatchSha256': hashlib.sha256(patch).hexdigest() if patch else None,
                'binarySha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(),
                'webAssets': {str(path.relative_to(ROOT / 'dist/web')): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in sorted((ROOT / 'dist/web').rglob('*')) if path.is_file()}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    spec = importlib.util.spec_from_file_location('memory_profiler', ROOT / 'scripts/profile-live-memory.py')
    profiler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(profiler)
    with tempfile.TemporaryDirectory(prefix='tiktools-live-benchmark-') as home:
        env = dict(os.environ, TIKTOOLS_HOME=home, TIKTOOLS_BENCH_CASE=args.case,
                   TIKTOOLS_BENCH_WARMUP=str(args.warmup), TIKTOOLS_BENCH_LOAD=str(args.load),
                   TIKTOOLS_BENCH_CLEANUP=str(args.cleanup), TIKTOOLS_BENCH_RATE=str(args.rate),
                   TIKTOOLS_BENCH_REVISION=identity, TIKTOOLS_BENCH_LIFECYCLE=args.lifecycle, TIKTOOLS_BENCH_ROW_LIMIT=str(args.row_limit),
                   TIKTOOLS_BENCH_OUTPUT=str((args.output / 'host-ui.ndjson').resolve()))
        if args.disable_row_blur:
            env['TIKTOOLS_BENCH_DISABLE_ROW_BLUR'] = '1'
        with (args.output / 'native.log').open('w') as log, (args.output / 'process-memory.ndjson').open('w') as memory:
            process = subprocess.Popen([str(args.binary.resolve()), '--exact', 'window::live_benchmark::native_live_matrix',
                                        '--nocapture', '--test-threads=1'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            began = time.monotonic()
            deadline = began + args.warmup + args.load + args.cleanup + 90
            try:
                while process.poll() is None:
                    elapsed = time.monotonic() - began
                    if time.monotonic() > deadline:
                        raise TimeoutError('native benchmark exceeded bounded deadline')
                    sample = memory_sample(profiler, process.pid)
                    phase = 'idle' if elapsed < args.warmup else 'load' if elapsed < args.warmup + args.load else 'cleanup'
                    memory.write(json.dumps({'elapsedSeconds': elapsed, 'phase': phase, **sample}) + '\n')
                    memory.flush()
                    time.sleep(1)
                if process.returncode:
                    raise SystemExit(f'native benchmark failed ({process.returncode}); inspect {args.output / "native.log"}')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)
    print(args.output)


if __name__ == '__main__':
    main()
