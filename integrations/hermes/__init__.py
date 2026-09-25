"""Full Hermes adapter for the standalone Jev decision layer.

Jev receives only host-supplied bounded choices. Hermes retains tool lookup,
permissions, approvals, native execution, retries, recovery, and final output.
The adapter is fail-open: transport or core errors become a Jev fallback and
never block Hermes's normal path.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

from .schemas import BROWSER_STEP, MODEL_ROUTE, RECORD_EXECUTION, ROUTE, SHADOW_COMPACTION, SUPERVISE

ROOT = Path(os.environ.get("JEV_LAYER_ROOT", Path(__file__).resolve().parents[2])).expanduser().resolve()
CORE = ROOT / "src" / "hermes-adapter.mjs"
_MAX_PENDING_DECISIONS = 64
_pending_decisions: OrderedDict[str, dict[str, Any]] = OrderedDict()
_pending_lock = threading.Lock()


def _fallback(reason: str) -> str:
    return json.dumps({
        "schema_version": 1,
        "status": "fallback",
        "selected": None,
        "reason": reason,
        "fallback": {"type": "adapter_error", "reason": reason},
        "execution": {"enabled": False, "status": "not_started"},
    })


def _runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    # Resolve only through Hermes's profile-scoped store, then pass it only to
    # this short-lived local Node adapter. It is never returned or logged.
    try:
        from agent.secret_scope import get_secret
        openrouter_key = get_secret("OPENROUTER_API_KEY")
        if openrouter_key:
            env["OPENROUTER_API_KEY"] = openrouter_key
    except Exception:
        # The core remains fail-open when the optional provider credential is unavailable.
        pass
    # Keep replay evidence in the active Hermes profile, never in the source checkout.
    env.setdefault("JEV_REPLAY_CASES", str(Path(env.get("HERMES_HOME", "~/.hermes")).expanduser() / "jev-layer" / "replay" / "cases.jsonl"))
    return env


def _call_core(operation: str, args: dict, *, decision: dict | None = None) -> dict:
    envelope: dict[str, Any] = {"operation": operation, "args": args}
    if decision is not None:
        envelope["decision"] = decision
    try:
        completed = subprocess.run(
            [os.environ.get("JEV_NODE", "node"), str(CORE)],
            input=json.dumps(envelope) + "\n", capture_output=True, text=True,
            timeout=float(os.environ.get("JEV_LAYER_TIMEOUT_S", "5")), cwd=ROOT,
            env=_runtime_env(), check=False,
        )
        if completed.returncode != 0:
            return json.loads(_fallback(completed.stderr.strip() or f"core exited with status {completed.returncode}"))
        line = next((line for line in completed.stdout.splitlines() if line.strip()), "")
        if not line:
            return json.loads(_fallback("core returned no response"))
        result = json.loads(line)
        return result if isinstance(result, dict) else json.loads(_fallback("core returned non-object response"))
    except Exception as error:
        return json.loads(_fallback(str(error)))


def _remember(decision: dict) -> None:
    correlation_id = decision.get("correlation_id")
    if not isinstance(correlation_id, str) or not correlation_id:
        return
    with _pending_lock:
        _pending_decisions[correlation_id] = decision
        _pending_decisions.move_to_end(correlation_id)
        while len(_pending_decisions) > _MAX_PENDING_DECISIONS:
            _pending_decisions.popitem(last=False)


def _take(correlation_id: str) -> dict | None:
    with _pending_lock:
        return _pending_decisions.pop(correlation_id, None)


def _route(args: dict, operation: str = "route") -> str:
    request = dict(args)
    request.setdefault("schema_version", 1)
    request.setdefault("harness", "hermes")
    result = _call_core(operation, request)
    if result.get("status") in {"selected", "fallback", "no_decision", "needs_confirmation"} and result.get("correlation_id"):
        _remember(result)
    result.pop("_jev_request", None)
    return json.dumps(result)


def jev_route(args: dict, **kwargs) -> str:
    """Choose from a closed Hermes-owned candidate set; never execute it."""
    return _route(args)


def jev_browser_step(args: dict, **kwargs) -> str:
    """Choose one bounded browser action; Hermes owns observation, approval and execution."""
    return _route(args, operation="browser_step")


def jev_model_route(args: dict, **kwargs) -> str:
    """Recommend a declared model profile; this never changes Hermes's model route."""
    return _route(args, operation="model_route")


def jev_shadow_compaction(args: dict, **kwargs) -> str:
    """Report Jev's conservative keep/drop candidates without mutating host context."""
    return json.dumps(_call_core("shadow_compaction", dict(args)))


def jev_supervise(args: dict, **kwargs) -> str:
    """Return a bounded work-state judgment; Hermes maps it to its own next action."""
    request = dict(args)
    request.setdefault("harness", "hermes")
    return json.dumps(_call_core("supervise", request))


def jev_record_execution(args: dict, **kwargs) -> str:
    """Append an execution receipt for a decision made in this Hermes process."""
    correlation_id = args.get("correlation_id")
    if not isinstance(correlation_id, str) or not correlation_id:
        return _fallback("correlation_id is required")
    decision = _take(correlation_id)
    if decision is None:
        return _fallback("unknown or expired Jev correlation_id; host execution remains authoritative")
    receipt = _call_core("record_execution", dict(args), decision=decision)
    return json.dumps(receipt)


def register(ctx):
    ctx.register_tool(name="jev_route", toolset="jev_layer", schema=ROUTE, handler=jev_route)
    ctx.register_tool(name="jev_model_route", toolset="jev_layer", schema=MODEL_ROUTE, handler=jev_model_route)
    ctx.register_tool(name="jev_shadow_compaction", toolset="jev_layer", schema=SHADOW_COMPACTION, handler=jev_shadow_compaction)
    ctx.register_tool(name="jev_record_execution", toolset="jev_layer", schema=RECORD_EXECUTION, handler=jev_record_execution)
    ctx.register_tool(name="jev_supervise", toolset="jev_layer", schema=SUPERVISE, handler=jev_supervise)
    ctx.register_tool(name="jev_browser_step", toolset="jev_layer", schema=BROWSER_STEP, handler=jev_browser_step)
