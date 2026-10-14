#!/usr/bin/env python3
"""Windows companion: py -m pip install psutil; accepts Linux sampler arguments."""
import pathlib
import runpy
import sys

if sys.platform != 'win32':
    raise SystemExit('This companion requires Windows; use profile-live-memory.py on Linux.')
runpy.run_path(str(pathlib.Path(__file__).with_name('profile-live-memory.py')), run_name='__main__')
