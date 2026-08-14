""" /quota — YouTube Data API quota (local estimate of remaining). """

from __future__ import annotations

from ._common import reply


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]

    @app.command("/quota")
    def cmd_quota(ack, body, client):
        ack()
        hint = ws.quota_hint()
        cost = hint.get("uploadCostUnits", 1600)
        daily = hint.get("defaultDailyQuota", 10000)
        used = hint.get("usedUnitsToday", 0)
        remaining = hint.get("remainingUnitsToday", daily)
        uploads_today = hint.get("uploadsToday", 0)
        uploads_left = hint.get("uploadsLeftToday", remaining // cost)
        day = hint.get("quotaDay") or "?"
        console = hint.get("consoleUrl") or ""
        text = (
            f"*YouTube quota* (day `{day}` PT)\n"
            f"• Used today (this bot): *{used}* / {daily} units "
            f"({uploads_today} upload{'s' if uploads_today != 1 else ''})\n"
            f"• Left (estimate): *{remaining}* units ≈ *{uploads_left}* upload"
            f"{'' if uploads_left == 1 else 's'} "
            f"({cost} each)\n"
            f"• Generating takes does *not* use quota — only Post / upload\n"
            f"• YouTube has no remaining-quota API — this tracks *our* uploads; "
            f"Cloud Console is exact if you upload elsewhere"
            + (f"\n<{console}|Open Cloud Console quotas>" if console else "")
        )
        reply(client, body, text)
