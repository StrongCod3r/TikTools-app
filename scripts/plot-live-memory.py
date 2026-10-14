#!/usr/bin/env python3
"""Plot attributed native retention A/B CSVs (optional dependency: matplotlib)."""
import argparse
import csv
import pathlib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=pathlib.Path)
    parser.add_argument('after', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    figure, axes = plt.subplots(3, 1, figsize=(9, 8), sharex=True)
    for path, label, color in [(args.before, 'Original IPC ownership', '#b64936'),
                               (args.after, 'IPC signal disconnected', '#167b95')]:
        with path.open() as source:
            rows = [row for row in csv.DictReader(source) if row['host_rss_kib']]
        elapsed = [float(row['elapsed_seconds']) for row in rows]
        axes[0].plot(elapsed, [float(row['host_rss_kib']) / 1024 for row in rows], label=label, color=color)
        axes[1].plot(elapsed, [float(row['webview_rss_kib']) / 1024 for row in rows], label=label, color=color)
        axes[2].plot(elapsed, [float(row['webview_processes']) for row in rows], label=label, color=color)
    axes[0].set_ylabel('Host RSS (MiB)')
    axes[1].set_ylabel('Child RSS sum (MiB)')
    axes[2].set_ylabel('WebKit child processes')
    axes[2].set_xlabel('Actual elapsed seconds')
    axes[0].legend(loc='upper right')
    for axis in axes:
        axis.grid(alpha=.2)
    figure.suptitle('100 native open/close cycles + 30 seconds cleanup\nLinux X11 · Wry 0.57 · WebKitGTK 2.54.1 · release test harness')
    figure.text(.5, .01, 'Child RSS sum includes shared pages; it is not private or unique physical memory. Prototype builds; full LIVE/Windows not measured.', ha='center', fontsize=8)
    figure.tight_layout(rect=(0, .035, 1, .94))
    figure.savefig(args.output, dpi=160)


if __name__ == '__main__':
    main()
