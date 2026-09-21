ROUTE = {
    "type": "object",
    "required": ["intent", "capabilities"],
    "properties": {
        "intent": {"type": "string"},
        "harness": {"type": "string"},
        "context": {"type": "object"},
        "actor_permissions": {"type": "array", "items": {"type": "string"}},
        "capabilities": {"type": "array", "items": {"type": "object"}},
        "policy": {"type": "object"},
        "provider": {"type": "string", "enum": ["demo", "typesafe", "openrouter"]},
        "engine": {"type": "string", "enum": ["native", "jevrouter"]},
    },
}

RECORD_EXECUTION = {
    "type": "object",
    "required": ["correlation_id", "status"],
    "properties": {
        "correlation_id": {"type": "string"},
        "harness": {"type": "string"},
        "capability_id": {"type": "string"},
        "status": {"type": "string", "enum": ["completed", "failed", "not_started"]},
        "result": {},
        "error": {},
        "browser": {"type": "object"},
        "exit_status": {"type": ["integer", "null"]},
        "duration_ms": {"type": ["number", "null"]},
        "started_at": {"type": ["string", "null"]},
        "completed_at": {"type": ["string", "null"]},
    },
}

SUPERVISE = {
    "type": "object",
    "required": ["job", "observation"],
    "properties": {
        "job": {"type": "object"},
        "observation": {"type": "object"},
        "evidence": {"type": "object"},
        "harness": {"type": "string"},
        "actor_permissions": {"type": "array", "items": {"type": "string"}},
        "policy": {"type": "object"},
        "attempts": {"type": "integer", "minimum": 0},
        "provider": {"type": "string", "enum": ["demo", "typesafe", "openrouter"]},
        "enabled": {"type": "boolean"},
    },
}

BROWSER_STEP = {
    "type": "object",
    "required": ["goal", "observation"],
    "properties": {
        "goal": {"type": "string"},
        "harness": {"type": "string"},
        "start_url": {"type": ["string", "null"]},
        "observation": {"type": "object"},
        "progress": {"type": "object"},
        "policy": {"type": "object"},
        "provider": {"type": "string", "enum": ["demo", "typesafe", "openrouter"]},
        "enabled": {"type": "boolean"},
    },
}
