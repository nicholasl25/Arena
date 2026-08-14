""" /arena-status — server + pipeline + latest candidate job.

Slack reserves /status, so this command cannot use that name.
"""

from __future__ import annotations

from ._common import reply


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]

    @app.command("/arena-status")
    def cmd_arena_status(ack, body, client):
        ack()
        pipe = ws.pipeline_status()
        stages = pipe.get("stages") or {}
        raw_n = len(stages.get("raw") or [])
        composed_n = len(stages.get("composed") or [])
        posted_n = len(stages.get("posted") or [])
        active = pipe.get("active") or {}

        setup = ws.load_auto_post_setup() or {}
        resolved = setup.get("resolved") or {}
        fighters = resolved.get("fighters") or []
        weapons = resolved.get("weapons") or []
        setup_line = "none saved"
        if fighters:
            setup_line = " vs ".join(str(x) for x in fighters)
            if weapons:
                setup_line += f" ({' / '.join(str(w) for w in weapons)})"
            setup_line += f" · mode `{setup.get('mode') or '?'}`"

        job = ws.latest_undecided_candidate_job()
        if job:
            job_line = (
                f"job `{job.get('jobId')}` — "
                f"{len(job.get('candidates') or [])} takes waiting "
                f"(use `/short-pick` or Post buttons)"
            )
        else:
            # Any recent decided job?
            job_line = "no open candidate job"

        text = (
            f"*Ball Arena status*\n"
            f"• Server: *up* (Slack Socket Mode connected)\n"
            f"• Pipeline: raw *{raw_n}* · composed *{composed_n}* · posted *{posted_n}*\n"
            f"• Latest raw: `{active.get('raw') or '—'}`\n"
            f"• Latest composed: `{active.get('composed') or '—'}`\n"
            f"• Last setup: {setup_line}\n"
            f"• Candidates: {job_line}"
        )
        reply(client, body, text)
