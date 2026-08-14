""" /cancel — skip the latest unfinished candidate job (nothing posted). """

from __future__ import annotations

from ._common import reply


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]

    @app.command("/cancel")
    def cmd_cancel(ack, body, client):
        ack()
        job = ws.latest_undecided_candidate_job()
        if not job:
            reply(client, body, "Nothing to cancel — no unfinished takes.")
            return
        job_id = job.get("jobId") or "?"
        n = len(job.get("candidates") or [])
        job["decided"] = "Cancelled via /cancel — nothing posted."
        ws.save_candidate_job(job)
        reply(
            client,
            body,
            f"Cancelled job `{job_id}` ({n} take{'s' if n != 1 else ''}) — nothing posted.",
        )
