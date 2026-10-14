#!/usr/bin/env python3
"""Opt-in process-tree RSS sampler. Windows requires optional psutil.
RSS sums include shared pages; they are not private/unique physical memory.
Never reads process arguments or environment variables.
"""
import argparse
import csv
import json
import pathlib
import os
import subprocess
import sys
import time


WINDOWS = sys.platform == 'win32'


def windows_snapshot(pid, processes):
    """Associate descendants by PID and creation time, never by name alone."""
    host = processes.get(pid)
    if host is None:
        return {}, False
    pending = [pid]
    seen = {}
    while pending and len(seen) < 256:
        current = pending.pop()
        if current in seen or current not in processes:
            continue
        parent = processes[current]
        seen[current] = parent
        pending.extend(child for child, info in processes.items()
                       if info['ppid'] == current and child != current
                       and info['created'] >= parent['created'])
    return seen, bool(pending)


def process_identity(pid):
    if WINDOWS:
        import psutil
        try:
            return psutil.Process(pid).create_time()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None
    try:
        fields = (pathlib.Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
        return fields[19]  # starttime: field 22
    except (OSError, ValueError, IndexError):
        return None


def process_sample(pid):
    try:
        root = pathlib.Path('/proc') / str(pid)
        status = root.joinpath('status').read_text()
        rss = next(int(line.split()[1]) for line in status.splitlines() if line.startswith('VmRSS:'))
        name = root.joinpath('comm').read_text().strip().lower()
        children = set()
        for task in root.joinpath('task').iterdir():
            try:
                children.update(task.joinpath('children').read_text().split())
            except OSError:
                continue
        return rss, name, [int(child) for child in children]
    except (OSError, ValueError, StopIteration):
        return None


def belongs_to_parent(child, parent):
    try:
        child_fields = (pathlib.Path('/proc') / str(child) / 'stat').read_text().rsplit(')', 1)[1].split()
        parent_fields = (pathlib.Path('/proc') / str(parent) / 'stat').read_text().rsplit(')', 1)[1].split()
        return int(child_fields[1]) == parent and int(child_fields[19]) >= int(parent_fields[19])
    except (OSError, ValueError, IndexError):
        return False


def cpu_ticks(stat):
    # comm may contain spaces and parentheses; fields after its final closing
    # parenthesis start at field 3. utime/stime are fields 14/15.
    fields = stat.rsplit(')', 1)[1].split()
    return int(fields[11]) + int(fields[12])


def host_activity(pid):
    try:
        root = pathlib.Path('/proc') / str(pid)
        status = root.joinpath('status').read_text()
        threads = next(int(line.split()[1]) for line in status.splitlines()
                       if line.startswith('Threads:'))
        ticks = cpu_ticks(root.joinpath('stat').read_text())
        return threads, ticks
    except (OSError, ValueError, IndexError, StopIteration):
        return None, None


def windows_processes():
    import psutil
    result = {}
    for process in psutil.process_iter(['pid', 'ppid', 'name', 'create_time', 'memory_info', 'num_threads', 'cpu_times']):
        try:
            info = process.info
            result[info['pid']] = {
                'ppid': info['ppid'], 'name': (info['name'] or '').lower(),
                'created': info['create_time'], 'rss': info['memory_info'].rss // 1024,
                'threads': info['num_threads'],
                'cpu': info['cpu_times'].user + info['cpu_times'].system,
            }
        except (psutil.NoSuchProcess, psutil.AccessDenied, TypeError, AttributeError):
            continue
    return result


def tree_activity(pid):
    pending, seen = [pid], set()
    threads = processes = webviews = 0
    while pending and len(seen) < 256:
        child = pending.pop()
        if child in seen:
            continue
        seen.add(child)
        sample = process_sample(child)
        if sample is None:
            continue
        processes += 1
        webviews += int('webkit' in sample[1] or 'webview' in sample[1])
        child_threads, _ = host_activity(child)
        threads += child_threads or 0
        pending.extend(child_pid for child_pid in sample[2] if belongs_to_parent(child_pid, child))
    return processes, webviews, threads


def descendants(pid):
    pending = [pid]
    seen = set()
    host = None
    plugins = webviews = other = 0
    while pending and len(seen) < 256:
        child = pending.pop()
        if child in seen:
            continue
        seen.add(child)
        sample = process_sample(child)
        if sample is None:
            continue
        rss, name, children = sample
        pending.extend(child_pid for child_pid in children if belongs_to_parent(child_pid, child))
        if child == pid:
            host = rss
        elif 'webkit' in name or 'webview' in name:
            webviews += rss
        elif 'plugin' in name or 'sonicboom' in name or 'l4d2' in name:
            plugins += rss
        else:
            other += rss
    return host, plugins, webviews, other, bool(pending)


def health(cli):
    try:
        result = subprocess.run([cli, 'rpc', 'system.health', '{}'], capture_output=True,
                                text=True, timeout=5, check=True)
        value = json.loads(result.stdout)
        counts = value.get('result', value) if isinstance(value, dict) else None
        return (counts, 'ok') if isinstance(counts, dict) else ({}, 'unavailable')
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}, 'unavailable'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True, help='running host PID')
    parser.add_argument('--cli', default='target/debug/tiktools')
    parser.add_argument('--samples', type=int, default=120)
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--label', default='unlabelled', help='workload/build label (up to 64 characters)')
    parser.add_argument('--commit', default='unknown', help='verified executable build SHA, not necessarily checkout HEAD')
    parser.add_argument('--phase', choices=['idle', 'load', 'cleanup'], default='load')
    args = parser.parse_args()
    if not 1 <= args.samples <= 3600 or not 0.1 <= args.interval <= 60 or args.pid <= 0:
        parser.error('use 1..3600 samples, 0.1..60 seconds, and a positive PID')
    if len(args.label) > 64 or any(ord(char) < 32 for char in args.label):
        parser.error('label must be at most 64 printable characters')
    if WINDOWS:
        try:
            import psutil  # optional Windows-only dependency
        except ImportError:
            parser.error('Windows sampling requires: py -m pip install psutil')
    previous_ticks = previous_at = None
    identity = process_identity(args.pid)
    clock_ticks = 1 if WINDOWS else os.sysconf('SC_CLK_TCK')
    began = time.monotonic()
    output = csv.writer(sys.stdout)
    output.writerow(['sample', 'host_rss_kib', 'plugin_rss_kib', 'webview_rss_kib',
                     'other_child_rss_kib', 'children_truncated', 'health', 'analytics_pending',
                     'analytics_failures', 'analytics_overload', 'plugin_workers',
                     'plugin_outstanding_calls', 'plugin_dropped_events', 'automation_tasks',
                     'points_hot', 'points_hot_capacity', 'points_writer_queued',
                     'points_write_errors', 'points_writer_overload', 'ingress_queued',
                     'ingress_accepted', 'ingress_dropped_data', 'ingress_dropped_critical',
                     'ingress_lagged', 'dedup_duplicates', 'automation_admitted',
                     'automation_rejected', 'automation_actions_failed', 'processor_overloaded',
                     'memory_host_rss_bytes', 'label', 'phase', 'elapsed_seconds',
                     'host_threads', 'host_cpu_percent', 'connection_generation', 'connection_state',
                     'build_commit', 'host_pid', 'process_tree_rss_sum_kib', 'tree_processes',
                     'webview_processes', 'tree_threads', 'memory_kind', 'desktop_diagnostics'])
    for index in range(args.samples):
        counts, state = health(args.cli)
        if counts.get('pid') is not None and counts['pid'] != args.pid:
            counts, state = {}, 'pid_mismatch'
        at = time.monotonic()
        same_host = identity is not None and process_identity(args.pid) == identity
        if not same_host:
            counts, state = {}, 'host_exited_or_reused'
        if WINDOWS:
            tree, truncated = windows_snapshot(args.pid, windows_processes()) if same_host else ({}, False)
            host = tree.get(args.pid)
            if host is not None and host['created'] != identity:
                tree, host, state = {}, None, 'host_exited_or_reused'
            threads, ticks = (host['threads'], host['cpu']) if host else (None, None)
            rss = [host['rss'] if host else None, 0, 0, 0, truncated]
            for child, info in tree.items():
                if child == args.pid:
                    continue
                lane = 2 if 'webview' in info['name'] or 'webkit' in info['name'] else 1 if 'plugin' in info['name'] else 3
                rss[lane] += info['rss']
            activity = len(tree), sum('webview' in info['name'] or 'webkit' in info['name'] for info in tree.values()), sum(info['threads'] for info in tree.values())
        else:
            threads, ticks = host_activity(args.pid) if same_host else (None, None)
            rss = descendants(args.pid) if same_host else (None, 0, 0, 0, False)
            activity = tree_activity(args.pid) if same_host else (0, 0, 0)
        cpu = None
        if ticks is not None and previous_ticks is not None and previous_at is not None and ticks >= previous_ticks:
            cpu = round(100 * (ticks - previous_ticks) / clock_ticks / (at - previous_at), 3)
        previous_ticks, previous_at = ticks, at
        connection = counts.get('liveConnection') or {}
        analytics = counts.get('analytics') or {}
        plugins = counts.get('plugins') or {}
        points = counts.get('points') or {}
        ingress = counts.get('liveIngress') or {}
        dedup = counts.get('liveDedup') or {}
        automation = counts.get('automation') or {}
        processors = counts.get('processorStats') or {}
        memory = counts.get('memory') or {}
        output.writerow([index, *rss, state,
                         analytics.get('pending'), analytics.get('failures'), analytics.get('overload'),
                         plugins.get('eventWorkers'), plugins.get('outstandingCalls'),
                         plugins.get('droppedEvents'), counts.get('automationActiveTasks'),
                         points.get('hotSize'), points.get('hotCapacity'),
                         points.get('writerQueued'), points.get('writeErrors'),
                         points.get('writerOverload'), ingress.get('queued'),
                         ingress.get('accepted'), ingress.get('droppedData'),
                         ingress.get('droppedCritical'), ingress.get('broadcastLagged'),
                         dedup.get('duplicates'), automation.get('admitted'),
                         automation.get('rejected'), automation.get('actionsFailed'),
                         processors.get('overloaded'), memory.get('hostRssBytes'),
                         args.label, args.phase, round(at - began, 3), threads, cpu,
                         connection.get('generation'), connection.get('state'),
                         args.commit, args.pid, sum(rss[:4]) if rss[0] is not None else None,
                         *activity, 'RSS_sum_shared_pages_included',
                         json.dumps(counts.get('desktop'), separators=(',', ':')) if counts.get('desktop') is not None else ''])
        sys.stdout.flush()
        if index + 1 < args.samples:
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
