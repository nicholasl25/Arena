"""Slack slash commands — one module per command."""

from __future__ import annotations

from . import cancel, long, quota, random_short, skins, status, weapons


def register_all(app, ctx: dict) -> None:
    for mod in (quota, status, cancel, skins, weapons, random_short, long):
        mod.register(app, ctx)
