""" /skins — list fighter skins by category. """

from __future__ import annotations

from ._common import reply


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]

    @app.command("/skins")
    def cmd_skins(ack, body, client):
        ack()
        rows = ws.list_skin_options()
        if not rows:
            reply(client, body, "No skins in `skins/` yet — use `/add-skin`.")
            return

        by_cat: dict[str, list[str]] = {}
        for row in rows:
            name = row["name"]
            if " / " in name:
                cat, _, label = name.partition(" / ")
            else:
                cat, label = "(top-level)", name
            by_cat.setdefault(cat, []).append(label)

        lines = [f"*{len(rows)} skins*"]
        # Keep Slack messages readable.
        for cat in sorted(by_cat.keys(), key=str.lower):
            labels = by_cat[cat]
            shown = labels[:20]
            extra = len(labels) - len(shown)
            bit = ", ".join(shown)
            if extra > 0:
                bit += f" … +{extra} more"
            lines.append(f"*{cat}* ({len(labels)}): {bit}")

        text = "\n".join(lines)
        if len(text) > 3500:
            text = text[:3400] + "\n_…truncated — open Mac `skins/` for full list_"
        reply(client, body, text)
