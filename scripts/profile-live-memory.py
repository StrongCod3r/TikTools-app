#!/usr/bin/env python3
"""Opt-in Linux process and system.health sampler; never reads process arguments."""
import argparse
import csv
import json
import pathlib
import os
import subprocess
import sys
import time


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
        pending.extend(children)
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
        return value.get('result', value), 'ok'
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}, 'unavailable'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', type=int, required=True, help='running host PID')
    parser.add_argument('--cli', default='target/debug/tiktools')
    parser.add_argument('--samples', type=int, default=120)
    parser.add_argument('--interval', type=float, default=1.0)
    parser.add_argument('--label', default='unlabelled', help='workload/build label (up to 64 characters)')
    parser.add_argument('--phase', choices=['idle', 'load', 'cleanup'], default='load')
    args = parser.parse_args()
    if not 1 <= args.samples <= 3600 or not 0.1 <= args.interval <= 60 or args.pid <= 0:
        parser.error('use 1..3600 samples, 0.1..60 seconds, and a positive PID')
    if len(args.label) > 64 or any(ord(char) < 32 for char in args.label):
        parser.error('label must be at most 64 printable characters')
    previous_ticks = previous_at = None
    clock_ticks = os.sysconf('SC_CLK_TCK')
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
                     'host_threads', 'host_cpu_percent', 'connection_generation', 'connection_state'])
    for index in range(args.samples):
        counts, state = health(args.cli)
        if counts.get('pid') is not None and counts['pid'] != args.pid:
            counts, state = {}, 'pid_mismatch'
        at = time.monotonic()
        threads, ticks = host_activity(args.pid)
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
        output.writerow([index, *descendants(args.pid), state,
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
                         connection.get('generation'), connection.get('state')])
        sys.stdout.flush()
        if index + 1 < args.samples:
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
