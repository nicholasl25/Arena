#!/usr/bin/env python3
"""
Local server for the Shorts production workflow UI.

Serves static files from Arena/ and exposes a small JSON API for pipeline state,
script/caption drafts, compose, and YouTube upload. Slack bot (Socket Mode)
starts alongside when server/.env has tokens — see server/slack_bot.py.

Run:
    ./venv/bin/python server/workflow_server.py
    open http://localhost:8764/pages/workflow.html
"""

from __future__ import annotations

from workflow_lib.assets import (
    add_skin_bytes,
    list_ball_options,
    list_intro_files,
    list_intro_options,
    list_powerup_options,
    list_skin_categories,
    list_skin_files,
    list_skin_options,
    list_skins_in_category,
    list_weapon_options,
    load_intro_placements,
    normalize_intro_placement,
    save_intro_placement,
    write_intro_manifest,
    write_skin_manifest,
)
from workflow_lib.captions import (
    DESCRIPTION_HASHTAG_COUNT,
    HASHTAG_POOL,
    build_description,
    build_long_description,
    build_long_title,
    build_title,
    is_tournament_final,
    pick_description_hashtags,
    to_hashtag,
)
from workflow_lib.config import (
    CATEGORY_DEFAULT,
    DEFAULT_DAILY_QUOTA,
    ARENA_DIR,
    INTROS_DIR,
    INTRO_EXTS,
    JOBS_DIR,
    PAGE_REDIRECTS,
    PIPELINE_DIR,
    PORT,
    PRIVACY_DEFAULT,
    QUOTA_LOG_PATH,
    RECORDINGS,
    SERVER_DIR,
    SETUP_PATH,
    SKINS_DIR,
    SKIN_EXTS,
    STAGES,
    TAGS_DEFAULT,
    TIKTOK_DIR,
    TIKTOK_SCRIPTS,
    UPLOAD_COST_UNITS,
    YT_DIR,
    YT_SCRIPTS,
)
from workflow_lib.handler import QuietThreadingHTTPServer, WorkflowHandler
from workflow_lib.main import main
from workflow_lib.pipeline_ops import (
    compose_video,
    convert_video,
    draft_script,
    draft_script_meta,
    ensure_stages,
    fighter_display_names,
    list_videos,
    load_compose_short,
    load_compose_tournament,
    load_prompt_matchup,
    load_tournament_record,
    offline_record_video,
    parse_fighter_slugs,
    parse_fighters,
    pipeline_status,
    python_executable,
    quota_hint,
    record_quota_upload,
    revert_pipeline,
    run_script,
    tiktok_configured,
    upload_tiktok,
    upload_video,
    validate_video,
)
from workflow_lib.shorts import (
    generate_short_candidates,
    latest_undecided_candidate_job,
    load_auto_post_setup,
    load_candidate_job,
    produce_one_short,
    save_auto_post_setup,
    save_candidate_job,
    setup_from_arena_form,
    setup_from_request,
    setup_from_weapon_form,
    upload_candidate,
)
from workflow_lib.tournament_api import (
    build_long_tournament_roster,
    produce_long_tournament,
    tournament_ensure_segment,
    tournament_preview,
    tournament_stitch,
)

if __name__ == "__main__":
    main()
