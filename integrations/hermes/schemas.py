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
    },
}
