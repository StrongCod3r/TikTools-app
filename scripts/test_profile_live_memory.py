"""Profiler parsing and missing-process regressions; no running host required."""
import importlib.util
import os
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'profile_live_memory', pathlib.Path(__file__).with_name('profile-live-memory.py'))
profiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profiler)


class ProfilerTests(unittest.TestCase):
    def test_windows_no_children_and_unrelated_webview(self):
        processes = {1: {'ppid': 0, 'created': 10}, 2: {'ppid': 0, 'created': 11}}
        self.assertEqual(profiler.windows_snapshot(1, processes), ({1: processes[1]}, False))
        self.assertEqual(profiler.windows_snapshot(99, processes), ({}, False))

    def test_windows_child_traversal_and_reused_parent_pid(self):
        processes = {1: {'ppid': 0, 'created': 10}, 2: {'ppid': 1, 'created': 11},
                     3: {'ppid': 2, 'created': 12}, 4: {'ppid': 1, 'created': 9}}
        tree, truncated = profiler.windows_snapshot(1, processes)
        self.assertEqual(set(tree), {1, 2, 3})
        self.assertFalse(truncated)

    def test_linux_traversal_deduplicates_shared_children(self):
        samples = {1: (10, 'host', [2, 3]), 2: (20, 'webkit', [3]), 3: (30, 'plugin', [])}
        with patch.object(profiler, 'process_sample', side_effect=samples.get), patch.object(profiler, 'belongs_to_parent', return_value=True):
            self.assertEqual(profiler.descendants(1), (10, 30, 20, 0, False))

    def test_reused_linux_child_is_not_attributed(self):
        samples = {1: (10, 'host', [2]), 2: (20, 'webkit', [])}
        with patch.object(profiler, 'process_sample', side_effect=samples.get), patch.object(profiler, 'belongs_to_parent', return_value=False):
            self.assertEqual(profiler.descendants(1), (10, 0, 0, 0, False))

    def test_missing_health(self):
        with patch.object(profiler.subprocess, 'run', side_effect=OSError):
            self.assertEqual(profiler.health('missing'), ({}, 'unavailable'))

    def test_csv_header_matches_row(self):
        import csv
        import io
        import sys
        output = io.StringIO()
        with patch.object(sys, 'argv', ['sampler', '--pid', str(os.getpid()), '--samples', '1']), patch.object(sys, 'stdout', output), patch.object(profiler, 'health', return_value=({}, 'unavailable')):
            profiler.main()
        rows = list(csv.reader(io.StringIO(output.getvalue())))
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(rows[0]), len(rows[1]))
        self.assertIn('process_tree_rss_sum_kib', rows[0])

    def test_cpu_ticks_accepts_parentheses_and_spaces_in_process_name(self):
        fields = ['R'] + ['0'] * 10 + ['23', '17'] + ['0'] * 8
        self.assertEqual(profiler.cpu_ticks('123 (name (with) spaces) ' + ' '.join(fields)), 40)

    def test_missing_host_is_unknown_not_zero_rss(self):
        with patch.object(profiler, 'process_sample', return_value=None):
            self.assertIsNone(profiler.descendants(123)[0])

    @unittest.skipUnless(pathlib.Path('/proc/self/status').exists(), 'Linux /proc required')
    def test_host_threads_and_cpu_agree_with_proc(self):
        threads, ticks = profiler.host_activity(os.getpid())
        self.assertGreaterEqual(threads, 1)
        self.assertGreaterEqual(ticks, 0)
        self.assertGreater(profiler.descendants(os.getpid())[0], 0)


if __name__ == '__main__':
    unittest.main()
