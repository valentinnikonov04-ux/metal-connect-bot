# METAL CONNECT

Telegram bot and Mini App for direct metalworking orders between customers and production contractors.

## Local Bot Run

1. Copy environment example:

```bash
cp .env.example .env
```

2. Fill `.env`:

```env
METAL_CONNECT_BOT_TOKEN=your_telegram_bot_token
METAL_CONNECT_WEBAPP_URL=https://your-public-mini-app-url.example
METAL_CONNECT_API_URL=https://your-api-domain.example
METAL_CONNECT_API_CORS_ORIGIN=https://your-github-name.github.io
METAL_CONNECT_SUPPORT_ADMIN_USERNAME=valentinn_nikonov
```

3. Run API:

```bash
python3 metal_connect_api.py
```

4. Run bot:

```bash
python3 metal_connect_simple_working.py
```

## Local Mini App Preview

```bash
python3 -m http.server 8088 --directory metal_connect_app/webapp
```

Open:

```text
http://127.0.0.1:8088
```

## Dev Run With Temporary HTTPS Tunnel

```bash
python3 scripts/run_with_miniapp.py
```

This starts:

- local Mini App server;
- temporary HTTPS tunnel;
- Telegram bot with `METAL_CONNECT_WEBAPP_URL`.

For stable production Mini App hosting, use GitHub Pages or another permanent HTTPS hosting.

## GitHub Pages

The Mini App static files are duplicated in `docs/` for GitHub Pages.

In GitHub repository settings:

1. Open `Settings -> Pages`.
2. Select `Deploy from a branch`.
3. Branch: `main`.
4. Folder: `/docs`.

GitHub will provide a permanent HTTPS URL. Put that URL into `.env` as:

```env
METAL_CONNECT_WEBAPP_URL=https://your-github-name.github.io/your-repo-name/
```

The Mini App needs a public HTTPS API URL too:

```env
METAL_CONNECT_API_URL=https://your-api-domain.example
METAL_CONNECT_API_CORS_ORIGIN=https://your-github-name.github.io
```

## Temporary Public API With ngrok

Install ngrok, then run:

```bash
ngrok http 8091
```

Copy the HTTPS forwarding URL into `.env`:

```env
METAL_CONNECT_API_URL=https://abc123.ngrok-free.app
METAL_CONNECT_API_CORS_ORIGIN=https://valentinnikonov04-ux.github.io
```

Start the API and bot in separate terminals:

```bash
python3 metal_connect_api.py
python3 metal_connect_simple_working.py
```
