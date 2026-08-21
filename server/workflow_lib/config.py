"""Paths and shared constants for the workflow server."""
from __future__ import annotations

from pathlib import Path

ARENA_DIR = Path(__file__).resolve().parent.parent.parent
SERVER_DIR = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ARENA_DIR / "pipeline"
RECORDINGS = ARENA_DIR / "recordings"
STAGES = {
    "raw": RECORDINGS / "raw",
    "composed": RECORDINGS / "composed",
    "posted": RECORDINGS / "posted",
}
SKINS_DIR = ARENA_DIR / "skins"
INTROS_DIR = ARENA_DIR / "intros"
SKIN_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
INTRO_EXTS = SKIN_EXTS
YT_DIR = ARENA_DIR / "youtube"
YT_SCRIPTS = YT_DIR / "scripts"
TIKTOK_DIR = ARENA_DIR / "tiktok"
TIKTOK_SCRIPTS = TIKTOK_DIR / "scripts"
SETUP_PATH = SERVER_DIR / "auto_post_setup.json"
LAST_RUN_PATH = SERVER_DIR / "last_slack_run.json"
JOBS_DIR = SERVER_DIR / "candidate_jobs"
QUOTA_LOG_PATH = SERVER_DIR / "youtube_quota_log.json"
UPLOAD_COST_UNITS = 1600
DEFAULT_DAILY_QUOTA = 10000
PORT = 8764
# Old root HTML entry points → pages/ (preserve bookmarks / muscle memory).
PAGE_REDIRECTS = {
    "/index.html": "/pages/index.html",
    "/workflow.html": "/pages/workflow.html",
    "/wheel.html": "/pages/wheel.html",
    "/bracket.html": "/pages/bracket.html",
    "/bracket-sandbox.html": "/pages/bracket-sandbox.html",
    "/offline-render.html": "/pages/offline-render.html",
    "/offline-bracket.html": "/pages/offline-bracket.html",
    "/simulate.html": "/pages/simulate.html",
}

PRIVACY_DEFAULT = "public"
TAGS_DEFAULT = "physics,simulation,shorts,gaming"
TAGS_LONG_DEFAULT = "physics,simulation,gaming,arena,tournament"
CATEGORY_DEFAULT = "20"
