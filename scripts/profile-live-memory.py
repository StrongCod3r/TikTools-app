#!/usr/bin/env python3
"""Opt-in Linux process and system.health sampler; never reads process arguments."""
import argparse
import csv
import json
import pathlib
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


def descendants(pid):
    pending = [pid]
    seen = set()
    host = plugins = webviews = other = 0
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
    args = parser.parse_args()
    if not 1 <= args.samples <= 3600 or not 0.1 <= args.interval <= 60 or args.pid <= 0:
        parser.error('use 1..3600 samples, 0.1..60 seconds, and a positive PID')
    output = csv.writer(sys.stdout)
    output.writerow(['sample', 'host_rss_kib', 'plugin_rss_kib', 'webview_rss_kib',
                     'other_child_rss_kib', 'children_truncated', 'health', 'analytics_pending',
                     'analytics_failures', 'analytics_overload', 'plugin_workers',
                     'plugin_outstanding_calls', 'plugin_dropped_events', 'automation_tasks'])
    for index in range(args.samples):
        counts, state = health(args.cli)
        analytics = counts.get('analytics') or {}
        plugins = counts.get('plugins') or {}
        output.writerow([index, *descendants(args.pid), state,
                         analytics.get('pending'), analytics.get('failures'), analytics.get('overload'),
                         plugins.get('eventWorkers'), plugins.get('outstandingCalls'),
                         plugins.get('droppedEvents'), counts.get('automationActiveTasks')])
        sys.stdout.flush()
        if index + 1 < args.samples:
            time.sleep(args.interval)


if __name__ == '__main__':
    main()
