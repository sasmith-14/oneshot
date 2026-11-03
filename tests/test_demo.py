"""The demo is part of the contract: every scenario's expectations must hold.

Running it here means a change that breaks a demonstrated guarantee - or a new
scenario whose expectations are wrong - fails the test suite loudly.
"""

from __future__ import annotations

import io

import pytest
from rich.console import Console

from demo import runner
from demo.scenarios import SCENARIOS

pytestmark = pytest.mark.integration


def test_every_demo_scenario_passes():
    out = io.StringIO()
    code = runner.main([], console=Console(file=out, width=140))
    assert code == 0, out.getvalue()[-4000:]
    assert out.getvalue().count("[PASS]") >= len(SCENARIOS)
    assert "[FAIL]" not in out.getvalue()


def test_scenario_names_are_unique():
    names = [s.name for s in SCENARIOS]
    assert len(names) == len(set(names))
