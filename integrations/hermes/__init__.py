"""Hermes adapter for the standalone Jev layer.

This plugin exposes only a decision tool. The selected capability remains
owned and executed by Hermes through its normal approval/tool path.
"""

import json
import os
import subprocess
from pathlib import Path

from .schemas import ROUTE

ROOT = Path(os.environ.get("JEV_LAYER_ROOT", Path(__file__).resolve().parents[2])).expanduser().resolve()
CLI = ROOT / "src" / "cli.mjs"

def _fallback(reason: str) -> str:
    return json.dumps({
        "schema_version": 1,
        "status": "fallback",
        "selected": None,
        "reason": reason,
        "fallback": {"type": "adapter_error", "reason": reason},
        "execution": {"enabled": False, "status": "not_started"},
    })


def jev_route(args: dict, **kwargs) -> str:
    """Return a bounded decision as JSON; never execute the selected target."""
    try:
        completed = subprocess.run(
            [os.environ.get("JEV_NODE", "node"), str(CLI), "--provider", os.environ.get("JEV_LAYER_PROVIDER", "demo")],
            input=json.dumps(args) + "\n",
            capture_output=True,
            text=True,
            timeout=float(os.environ.get("JEV_LAYER_TIMEOUT_S", "3")),
            check=False,
        )
        if completed.returncode != 0:
            return _fallback(completed.stderr.strip() or f"core exited with status {completed.returncode}")
        line = next((line for line in completed.stdout.splitlines() if line.strip()), "")
        if not line:
            return _fallback("core returned no decision")
        json.loads(line)
        return line
    except Exception as error:
        return _fallback(str(error))


def register(ctx):
    ctx.register_tool(name="jev_route", toolset="jev_layer", schema=ROUTE, handler=jev_route)
