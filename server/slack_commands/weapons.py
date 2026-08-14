""" /weapons — list premade weapons. """

from __future__ import annotations

from ._common import reply


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]

    @app.command("/weapons")
    def cmd_weapons(ack, body, client):
        ack()
        rows = ws.list_weapon_options()
        if not rows:
            reply(client, body, "No weapons found in `premade-weapons/`.")
            return
        names = [f"`{row['id']}` {row['name']}" for row in rows]
        text = f"*{len(rows)} weapons*\n" + " · ".join(names)
        if len(text) > 3500:
            text = text[:3400] + "\n_…truncated_"
        reply(client, body, text)
