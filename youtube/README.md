# YouTube Shorts pipeline

Self-contained upload + voiceover tooling for Ball Arena recordings.

## One-time setup

```bash
cd resources/web/fun/youtube
cp .env.example .env          # add YT_CLIENT_ID + YT_CLIENT_SECRET
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/auth.py
```

See [setup.md](setup.md) for Google Cloud OAuth steps.

## Run

Edit CONFIG in `pipeline/compose_short.py`, then from `fun/`:

```bash
python pipeline/compose_short.py       # voiceover + captions only
python server/workflow_server.py       # full workflow UI + API
```

| Script | Role |
|--------|------|
| `../pipeline/compose_short.py` | TTS voiceover + CapCut-style captions over fight |
| `../server/workflow_server.py` | Workflow UI server + compose/upload API |
| `scripts/upload_short.py` | YouTube Data API upload |
| `scripts/validate_short.py` | Check Shorts format (duration, aspect) |
| `scripts/convert_for_short.py` | webm → mp4 fallback |
| `scripts/auth.py` | One-time OAuth → `token.json` |

Credentials live in `youtube/.env` and `youtube/token.json` (gitignored).
