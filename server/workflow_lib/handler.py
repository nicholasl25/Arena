"""HTTP handler for the workflow UI JSON API + static files."""
from __future__ import annotations

import base64
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .assets import (
    add_skin_bytes,
    list_weapon_options,
    load_intro_placements,
    save_intro_placement,
    write_intro_manifest,
    write_skin_manifest,
)
from .captions import (
    build_description,
    build_long_description,
    build_long_title,
    build_title,
    is_tournament_final,
)
from .config import (
    CATEGORY_DEFAULT,
    FUN_DIR,
    PAGE_REDIRECTS,
    PRIVACY_DEFAULT,
    TAGS_DEFAULT,
)
from .pipeline_ops import (
    compose_video,
    draft_script_meta,
    fighter_display_names,
    load_compose_tournament,
    offline_record_video,
    pipeline_status,
    quota_hint,
    revert_pipeline,
    upload_video,
)
from .shorts import (
    generate_short_candidates,
    load_auto_post_setup,
    save_auto_post_setup,
    setup_from_request,
    setup_from_weapon_form,
    upload_candidate,
)
from .tournament_api import (
    tournament_ensure_segment,
    tournament_preview,
    tournament_stitch,
)


class WorkflowHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FUN_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        line = str(args[0]) if args else ""
        if line.startswith("GET /api") or line.startswith("POST /api"):
            super().log_message(format, *args)

    def _is_loopback(self) -> bool:
        host = self.client_address[0]
        return host in {"127.0.0.1", "::1"} or host.startswith("::ffff:127.")

    def _remote_allowed(self, path: str) -> bool:
        return self._is_loopback()

    def _json_response(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        text = raw.decode("utf-8")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype in {"text/plain", "text/markdown"}:
            prompt = text.strip()
            return {"prompt": prompt} if prompt else {}
        if not text.strip():
            return {}
        return json.loads(text)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def end_headers(self) -> None:
        path = urlparse(self.path).path
        if path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def copyfile(self, source, outputfile) -> None:
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _do_GET(self) -> None:
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if not self._remote_allowed(parsed.path):
            self._json_response({"error": "Forbidden"}, 403)
            return

        if parsed.path in PAGE_REDIRECTS:
            dest = PAGE_REDIRECTS[parsed.path]
            if parsed.query:
                dest = f"{dest}?{parsed.query}"
            self._redirect(dest)
            return

        if parsed.path == "/api/setup":
            setup = load_auto_post_setup()
            if not setup:
                self._json_response({"saved": False})
                return
            self._json_response({"saved": True, "setup": setup})
            return

        if parsed.path == "/api/skins":
            self._json_response({"files": write_skin_manifest()})
            return

        if parsed.path == "/api/weapons":
            self._json_response({"weapons": list_weapon_options()})
            return

        if parsed.path == "/api/intros":
            self._json_response({"files": write_intro_manifest()})
            return

        if parsed.path == "/api/intros/placements":
            self._json_response({"placements": load_intro_placements()})
            return

        if parsed.path == "/api/pipeline":
            self._json_response(pipeline_status())
            return

        if parsed.path == "/api/tournament/status":
            try:
                self._json_response({"ok": True, **load_compose_tournament().status_payload()})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/quota":
            self._json_response(quota_hint())
            return

        if parsed.path == "/api/draft-script":
            raw_name = (qs.get("file") or [None])[0]
            if not raw_name:
                self._json_response({"error": "file query required"}, 400)
                return
            try:
                meta = draft_script_meta(raw_name)
                self._json_response({"file": raw_name, **meta})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 404)
            return

        if parsed.path == "/api/draft-caption":
            composed_name = (qs.get("file") or [None])[0]
            if not composed_name:
                self._json_response({"error": "file query required"}, 400)
                return
            if is_tournament_final(composed_name):
                manifest = load_compose_tournament().load_manifest()
                self._json_response({
                    "file": composed_name,
                    "title": build_long_title(manifest),
                    "description": build_long_description(manifest),
                    "privacy": PRIVACY_DEFAULT,
                    "tags": "physics,simulation,gaming,arena,tournament",
                    "category": CATEGORY_DEFAULT,
                })
                return
            names, _ = fighter_display_names(composed_name)
            self._json_response({
                "file": composed_name,
                "title": build_title(names),
                "description": build_description(*names),
                "privacy": PRIVACY_DEFAULT,
                "tags": TAGS_DEFAULT,
                "category": CATEGORY_DEFAULT,
            })
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if not self._remote_allowed(parsed.path):
            self._json_response({"error": "Forbidden"}, 403)
            return

        try:
            body = self._read_json_body()
        except json.JSONDecodeError:
            self._json_response({"error": "Invalid JSON"}, 400)
            return

        if parsed.path == "/api/short/candidates":
            try:
                prompt = body.get("prompt")
                count = int(body.get("count") or 3)
                if body.get("fighterA") and body.get("fighterB"):
                    setup = setup_from_weapon_form(
                        body["fighterA"],
                        body["fighterB"],
                        body.get("weaponA"),
                        body.get("weaponB"),
                    )
                else:
                    setup = setup_from_request(body=body, prompt=prompt)
                result = generate_short_candidates(setup, count=count)
                self._json_response(result)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/short/select":
            try:
                job_id = str(body.get("jobId") or "").strip()
                index = int(body.get("index"))
                result = upload_candidate(job_id, index)
                self._json_response(result)
            except (TypeError, ValueError) as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/skins/upload":
            try:
                name = str(body.get("name") or "").strip()
                b64 = body.get("data") or body.get("base64") or ""
                if not name or not b64:
                    self._json_response({"error": "name and data (base64) required"}, 400)
                    return
                if isinstance(b64, str) and "," in b64 and b64.strip().startswith("data:"):
                    b64 = b64.split(",", 1)[1]
                raw = base64.b64decode(b64)
                ext = str(body.get("ext") or ".png")
                result = add_skin_bytes(
                    name,
                    raw,
                    ext=ext,
                    category=body.get("category"),
                )
                self._json_response(result)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/setup":
            try:
                if body.get("prompt") and not body.get("matchup"):
                    saved = setup_from_request(body=body)
                else:
                    saved = save_auto_post_setup(body)
                self._json_response({"ok": True, "setup": saved})
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/compose":
            raw_name = body.get("file", "")
            script = body.get("script", "").strip()
            if not raw_name or not script:
                self._json_response({"error": "file and script required"}, 400)
                return
            try:
                result = compose_video(raw_name, script)
                self._json_response({"ok": True, **result, "pipeline": pipeline_status()})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/tournament/ensure-segment":
            try:
                result = tournament_ensure_segment(body)
                self._json_response(result)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/tournament/stitch":
            try:
                result = tournament_stitch(body)
                self._json_response(result)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/tournament/preview":
            try:
                result = tournament_preview(body)
                self._json_response(result)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/intros/placements":
            intro_id = str(body.get("id") or "").strip()
            if not intro_id:
                self._json_response({"error": "id required"}, 400)
                return
            try:
                placement = save_intro_placement(intro_id, body)
                self._json_response({"ok": True, "id": intro_id.lower(), "placement": placement})
            except ValueError as exc:
                self._json_response({"error": str(exc)}, 400)
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/offline-record":
            mode = (body.get("mode") or "collision").strip()
            matchup = body.get("matchup")
            intro_mode = body.get("introMode")
            intros = body.get("intros")
            if mode not in {"collision", "weapon"}:
                self._json_response({"error": "mode must be collision or weapon"}, 400)
                return
            if not isinstance(matchup, list) or len(matchup) < 2:
                self._json_response({"error": "matchup must include at least 2 fighters"}, 400)
                return
            try:
                result = offline_record_video(mode, matchup, intro_mode=intro_mode, intros=intros)
                self._json_response({"ok": True, **result, "pipeline": pipeline_status()})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/upload":
            composed_name = body.get("file", "")
            title = body.get("title", "").strip()
            description = body.get("description", "").strip()
            if not composed_name or not title:
                self._json_response({"error": "file and title required"}, 400)
                return
            try:
                result = upload_video(
                    composed_name,
                    title,
                    description,
                    privacy=body.get("privacy", PRIVACY_DEFAULT),
                    tags=body.get("tags", TAGS_DEFAULT),
                    category=body.get("category", CATEGORY_DEFAULT),
                )
                self._json_response({"ok": True, **result, "pipeline": pipeline_status()})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        if parsed.path == "/api/redo":
            step = body.get("step", "").strip()
            if step not in {"record", "compose", "youtube"}:
                self._json_response({"error": "step must be record, compose, or youtube"}, 400)
                return
            try:
                state = revert_pipeline(step)
                self._json_response({"ok": True, "step": step, "pipeline": state})
            except Exception as exc:  # noqa: BLE001
                self._json_response({"error": str(exc)}, 500)
            return

        self._json_response({"error": "Not found"}, 404)


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address) -> None:
        """Ignore client disconnects mid-response (refresh / navigate away)."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)

