"""Pytest config for rag/tests — registers custom marks used in this folder."""
from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "slow: tests that download models or take more than a few seconds"
    )
