"""mxwp-import — bulk-upload .docx (+ matching .json metadata) to an
MXWhitePaper server.

The package is intentionally split so each module is small and tests can
substitute fakes (no live server required):

  config.py   — YAML + env + CLI merge → frozen Config
  scanner.py  — folder walk → WorkItem pairs (docx + optional json)
  client.py   — stdlib-only HTTP client (urllib + manual multipart)
  rate.py     — simple sleep-based pacing
  log.py      — human stdout + JSONL audit
  uploader.py — process_one + process_all (the actual work)
  cli.py      — argparse glue
"""
from __future__ import annotations

__version__ = "1.0.0"
