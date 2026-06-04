# METAL CONNECT Web

Отдельный веб-сайт с функционалом Mini App, но без Telegram WebApp API.

## Локальный запуск

1. Запустите API сайта:

```bash
cd /Users/bossbaby/Desktop/мой_бот
METAL_CONNECT_SITE_API_PORT=8092 python3 api_site.py
```

По умолчанию API использует отдельную SQLite-базу:

```text
metal_connect_site.db
```

2. Запустите фронт сайта:

```bash
cd /Users/bossbaby/Desktop/мой_бот
python3 -m http.server 8089 --directory site
```

3. Откройте:

```text
http://127.0.0.1:8089
```

## Переменные окружения

```env
METAL_CONNECT_SITE_DB=metal_connect_site.db
METAL_CONNECT_SITE_API_HOST=127.0.0.1
METAL_CONNECT_SITE_API_PORT=8092
METAL_CONNECT_SITE_API_URL=https://your-site-api.example
METAL_CONNECT_SITE_CORS_ORIGIN=https://your-github-name.github.io
METAL_CONNECT_SITE_JWT_SECRET=replace-with-long-random-secret
```

Для GitHub Pages измените `window.DEFAULT_API_URL` в `site/index.html` на публичный HTTPS URL API.

## Авторизация

Сайт поддерживает:

- регистрацию: `/api/register` или `/register`;
- вход: `/api/login` или `/login`;
- выход: `/api/logout` или `/logout`.

Все рабочие эндпоинты `/api/*` требуют заголовок:

```http
Authorization: Bearer <token>
```

`user_id` берется только из токена, а не из URL или тела запроса.
