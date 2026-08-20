""" /retry — re-run the most recent /short, /random-short, or /long.

Retries on failure: default attempts = max(1, prior errorCount), capped at 5.
Optional: `/retry 3` to force N attempts.
"""

from __future__ import annotations

import traceback
from pathlib import Path

from ._common import reply, resolve_channel, run_async

_MAX_ATTEMPTS = 5


def _parse_attempts(text: str, error_count: int) -> int:
    raw = (text or "").strip().split()
    if raw:
        try:
            n = int(raw[0])
            return max(1, min(_MAX_ATTEMPTS, n))
        except ValueError:
            pass
    # Keep trying about as often as this run has already failed.
    return max(1, min(_MAX_ATTEMPTS, int(error_count or 0) or 1))


def register(app, ctx: dict) -> None:
    ws = ctx["ws"]
    run_candidates = ctx["run_candidates_job"]
    upload_take = ctx["upload_take_to_slack"]
    composed_dir = Path(ctx["composed_dir"])

    @app.command("/retry")
    def cmd_retry(ack, body, client):
        ack()
        user = body.get("user_id") or ""
        run = ws.load_last_run()
        if not run:
            reply(
                client,
                body,
                "Nothing to retry — run `/short`, `/random-short`, or `/long` first.",
            )
            return

        kind = run.get("kind") or "?"
        label = run.get("label") or kind
        payload = run.get("payload") or {}
        prior_errors = int(run.get("errorCount") or 0)
        attempts = _parse_attempts(body.get("text") or "", prior_errors)
        status = run.get("status") or "pending"
        last_err = run.get("error")

        ch = resolve_channel(client, body)
        hint = f" (last error: `{last_err}`)" if last_err and status == "failed" else ""
        reply(
            client,
            body,
            f"Retrying *{kind}* — *{label}* · up to *{attempts}* attempt"
            f"{'s' if attempts != 1 else ''}{hint}",
        )

        def work():
            last_exc: BaseException | None = None
            for attempt in range(1, attempts + 1):
                try:
                    if attempt > 1:
                        client.chat_postMessage(
                            channel=ch,
                            text=(
                                f"<@{user}> Retry *{attempt}/{attempts}* for *{label}* "
                                f"(after: `{last_exc}`)…"
                            ),
                        )
                    if kind in {"short", "random-short"}:
                        setup = payload.get("setup")
                        count = int(payload.get("count") or (1 if kind == "random-short" else 3))
                        if not isinstance(setup, dict):
                            raise ValueError("saved short setup is missing")
                        run_candidates(
                            client,
                            channel=ch,
                            user=user,
                            setup=setup,
                            count=count,
                        )
                        ws.mark_last_run_ok()
                        return

                    if kind == "long":
                        roster = payload.get("roster")
                        if not isinstance(roster, list) or len(roster) < 2:
                            raise ValueError("saved long roster is missing")
                        powerup_spin = bool(payload.get("powerup_spin", True))
                        weapon_spin = bool(payload.get("weapon_spin", False))
                        weapon_ids = payload.get("weapon_ids")
                        skin_folder = payload.get("skin_folder")
                        status_msg = client.chat_postMessage(
                            channel=ch,
                            text=(
                                f"<@{user}> *Long retry {attempt}/{attempts}* — *{label}*\n"
                                "_recording bracket + fights…_"
                            ),
                        )
                        status_ts = status_msg.get("ts")

                        def on_progress(info: dict, _attempt=attempt) -> None:
                            phase = info.get("phase") or ""
                            detail = info.get("detail") or ""
                            line = (
                                f"<@{user}> *Long retry {_attempt}/{attempts}* — *{label}*\n"
                                f"_{phase}_ {detail}"
                            ).rstrip()
                            try:
                                client.chat_update(channel=ch, ts=status_ts, text=line)
                            except Exception:  # noqa: BLE001
                                pass

                        result = ws.produce_long_tournament(
                            roster,
                            powerup_spin=powerup_spin,
                            weapon_spin=weapon_spin,
                            weapon_ids=weapon_ids,
                            skin_folder=skin_folder,
                            on_progress=on_progress,
                        )
                        path = Path(result.get("path") or (composed_dir / "tournament-final.mp4"))
                        champ = result.get("champion") or "?"
                        caption = (
                            f"*Long tournament ready* — champion *{champ}*\n"
                            f"`{result.get('final')}` · {result.get('segmentCount')} segments\n"
                            "Use the button below to upload to YouTube."
                        )
                        try:
                            client.chat_update(
                                channel=ch,
                                ts=status_ts,
                                text=f"<@{user}> {caption}",
                                blocks=[
                                    {
                                        "type": "section",
                                        "text": {
                                            "type": "mrkdwn",
                                            "text": f"<@{user}> {caption}",
                                        },
                                    },
                                    {
                                        "type": "actions",
                                        "block_id": "long_post",
                                        "elements": [
                                            {
                                                "type": "button",
                                                "action_id": "long_post_youtube",
                                                "text": {
                                                    "type": "plain_text",
                                                    "text": "Post to YouTube",
                                                },
                                                "style": "primary",
                                                "value": "tournament-final.mp4",
                                            }
                                        ],
                                    },
                                ],
                            )
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                        upload_take(
                            client,
                            channel=ch,
                            path=path,
                            caption=f"<@{user}> Champion *{champ}* — full long video",
                            title="tournament-final",
                        )
                        ws.mark_last_run_ok()
                        return

                    raise ValueError(f"unknown saved kind: {kind}")
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    traceback.print_exc()
                    ws.mark_last_run_failed(exc)
                    if attempt >= attempts:
                        reply(
                            client,
                            {"user_id": user, "channel_id": ch},
                            f"`/retry` failed after *{attempts}* attempt"
                            f"{'s' if attempts != 1 else ''}: `{exc}`",
                        )
                        return

        run_async(work)
