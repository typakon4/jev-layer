"""Hermes entrypoint for the self-contained Jev layer plugin."""

from .integrations.hermes import register

__all__ = ["register"]
