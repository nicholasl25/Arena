# YouTube Short upload — one-time setup

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or pick an existing one)
3. **APIs & Services → Library** → enable **YouTube Data API v3**

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (or Internal if Workspace)
3. Add scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.force-ssl` (custom thumbnails from the intro still)
4. Add your Google account as a **test user** (while app is in Testing)

## 3. OAuth client credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Desktop app**
3. Download JSON or copy Client ID and Client Secret

## 4. Configure this skill

```bash
cd youtube
cp .env.example .env
# Edit .env with YT_CLIENT_ID and YT_CLIENT_SECRET
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/auth.py
```

`auth.py` opens a browser. Sign in with the **YouTube channel** Google account. Token saves to `token.json`.

If you already authenticated before custom thumbnails, run `auth.py` again so the token picks up `youtube.force-ssl`. YouTube also requires the channel to be verified (phone) before custom thumbnails stick.

## 5. Test upload

Use `unlisted` first:

```bash
python scripts/upload_short.py \
  --file "/path/to/test.webm" \
  --title "Test upload #Shorts" \
  --description "API test — ignore" \
  --privacy unlisted
```

## Quota

- Default: 10,000 units/day
- Each `videos.insert`: 1,600 units (~6 uploads/day)
- Request increase: Cloud Console → YouTube Data API v3 → Quotas

## Going public (optional)

Projects created after July 2020 may upload **private only** until Google verifies your OAuth app. For personal use, staying in **Testing** with test users is usually enough.

For a public OAuth app (any Google user can auth), submit for **Google verification** — can take weeks.
