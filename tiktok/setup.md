# TikTok upload — one-time setup

Same idea as YouTube (`youtube/setup.md`): developer app → OAuth once → `token.json` → Post from Slack / workflow.

TikTok is stricter: **HTTPS redirect** (no `localhost`) and **unaudited apps can only post private / self-only** until TikTok audits you.

## 1. TikTok Developer app

1. Open [developers.tiktok.com](https://developers.tiktok.com/) → log in with the TikTok account that should own the posts
2. **Manage apps → Create an app** (Web)
3. Add product: **Content Posting API**
4. Enable **Direct Post** on that product
5. Request scopes:
   - `user.info.basic`
   - `video.publish` (direct post — what we want)
   - `video.upload` (inbox/drafts fallback)

Until the app passes TikTok’s **audit**, every API post is **SELF_ONLY** (only you can see it). That’s expected. Public posting needs the audit.

## 2. HTTPS redirect (required)

TikTok rejects `http://localhost`. Use ngrok in front of the local auth callback.

```bash
# separate terminal — keep it running while you auth
ngrok http 8765
```

Copy the `https://….ngrok-free.app` URL.

In the TikTok app → **Login Kit / Redirect URI**, add:

```
https://YOUR-NGROK.ngrok-free.app/callback
```

## 3. Configure this folder

```bash
cd tiktok
cp .env.example .env
```

Edit `.env`:

```
TIKTOK_CLIENT_KEY=...          # from the TikTok app
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://YOUR-NGROK.ngrok-free.app/callback
```

No extra venv — uses stdlib + the existing Arena venv Python.

## 4. Sign in once

Keep **ngrok** running, then:

```bash
# from the Arena repo root
./venv/bin/python tiktok/scripts/auth.py
```

Browser opens TikTok → authorize → callback saves `tiktok/token.json`.

Re-auth later the same way if the refresh token expires (~1 year) or you revoke the app.

## 5. Test upload (private / self-only)

```bash
./venv/bin/python tiktok/scripts/upload_short.py \
  --file recordings/composed/some-final.mp4 \
  --title "Ball Arena test" \
  --privacy private
```

Should print JSON with `publishId` / `status`. Check TikTok **Profile → private / only you**.

## 6. Slack / workflow

Restart `arena` (workflow server). If `tiktok/token.json` exists, **Post take** / **Post to YouTube** also tries TikTok with the same caption. YouTube still moves the file to `posted/`; TikTok failure is reported but does not undo YouTube.

## Going public

Cloud Console analog: TikTok app → submit for **audit**. After approval, `PUBLIC_TO_EVERYONE` works if the account allows it.

## Differences vs YouTube

| | YouTube | TikTok |
|--|---------|--------|
| Quota | 10k units/day (~6 uploads) | Separate rate limits; not the YT pool |
| OAuth | localhost OK | HTTPS redirect required |
| Unaudited | can post public (if app in Testing + test user) | **self-only / private only** |
| Caption | title + description | `post_info.title` (caption) |
