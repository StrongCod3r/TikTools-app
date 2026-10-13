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
