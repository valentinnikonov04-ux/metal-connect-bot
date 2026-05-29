import base64
import json
import logging
import mimetypes
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from metal_connect_app.config import API_CORS_ORIGIN, API_HOST, API_PORT, TOKEN
from metal_connect_app.database import db_all, db_execute, db_one, init_db
from metal_connect_app.services import now_iso, user_rating


STATUS_TO_API = {
    "new": "open",
    "work": "in_progress",
    "done": "completed",
    "cancelled": "cancelled",
}
STATUS_FROM_API = {value: key for key, value in STATUS_TO_API.items()}

OFFER_TO_API = {
    "new": "pending",
    "accepted": "accepted",
    "declined": "declined",
}
OFFER_FROM_API = {value: key for key, value in OFFER_TO_API.items()}
NGROK_URL_PATH = Path(".ngrok_url")
CURRENT_NGROK_URL = ""
RESPONSE_CACHE = {}
CACHE_TTL_SECONDS = 5


def clean_public_url(value):
    url = (value or "").strip().rstrip("/")
    if not url.startswith("https://"):
        raise ValueError("URL must start with https://")
    return url


def load_ngrok_url():
    global CURRENT_NGROK_URL
    if NGROK_URL_PATH.exists():
        CURRENT_NGROK_URL = NGROK_URL_PATH.read_text(encoding="utf-8").strip()
    return CURRENT_NGROK_URL


def set_ngrok_url(value):
    global CURRENT_NGROK_URL
    CURRENT_NGROK_URL = clean_public_url(value)
    NGROK_URL_PATH.write_text(CURRENT_NGROK_URL + "\n", encoding="utf-8")
    logging.info("Ngrok URL обновлён: %s", CURRENT_NGROK_URL)
    return CURRENT_NGROK_URL


def public_api_url():
    return CURRENT_NGROK_URL or load_ngrok_url()


def github_redirect_uri(path="/api/github/callback"):
    base_url = public_api_url()
    return f"{base_url}{path}" if base_url else ""


def row_dict(row):
    return dict(row) if row else None


def rows_dict(rows):
    return [dict(row) for row in rows]


def api_status(status):
    return STATUS_TO_API.get(status, status or "")


def db_status(status):
    return STATUS_FROM_API.get(status, status or "new")


def api_offer_status(status):
    return OFFER_TO_API.get(status, status or "")


def db_offer_status(status):
    return OFFER_FROM_API.get(status, status or "new")


def order_is_open(status):
    return (status or "") in {"new", "open"}


def order_is_in_progress(status):
    return (status or "") in {"work", "in_progress"}


def offer_is_pending(status):
    return (status or "") in {"new", "pending"}


def int_param(query, name, default=0):
    try:
        return int((query.get(name) or [default])[0] or default)
    except (TypeError, ValueError):
        return default


def page_params(query, default_limit=20, max_limit=50):
    limit = int_param(query, "limit", default_limit)
    offset = int_param(query, "offset", 0)
    limit = max(1, min(limit or default_limit, max_limit))
    offset = max(0, offset)
    return limit, offset


def body_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def telegram_user_id(handler):
    init_data = handler.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        return 0
    try:
        data = parse_qs(init_data)
        user_values = data.get("user") or []
        if not user_values:
            return 0
        user = json.loads(user_values[0])
        return int(user.get("id") or 0)
    except (TypeError, ValueError, json.JSONDecodeError):
        return 0


def request_user_id(handler, query=None, body=None):
    if body and body.get("user_id"):
        try:
            return int(body.get("user_id") or 0)
        except (TypeError, ValueError):
            return 0
    if query:
        user_id = int_param(query, "user_id")
        if user_id:
            return user_id
    return telegram_user_id(handler)


def log_request(handler, method, path, user_id=0, body=None):
    logging.info(
        "API request method=%s path=%s user_id=%s body=%s",
        method,
        path,
        user_id or "",
        json.dumps(compact_log_body(body or {}), ensure_ascii=False),
    )


def compact_log_body(body):
    compact = {}
    for key, value in (body or {}).items():
        if isinstance(value, str) and len(value) > 300:
            compact[key] = f"<{len(value)} chars>"
        else:
            compact[key] = value
    return compact


def clear_cache():
    RESPONSE_CACHE.clear()


def data_url_parts(value):
    if not isinstance(value, str) or not value.startswith("data:") or "," not in value:
        return None, None
    meta, payload = value.split(",", 1)
    mime = meta[5:].split(";", 1)[0] or "application/octet-stream"
    return mime, payload


def ensure_user(user_id, role=None):
    if not user_id:
        return
    existing = db_one("SELECT id, role FROM users WHERE id=?", (user_id,))
    if existing:
        if role in {"customer", "executor"} and not existing["role"]:
            db_execute("UPDATE users SET role=?, updated_at=? WHERE id=?", (role, now_iso(), user_id))
        return
    db_execute(
        """
        INSERT INTO users(id, username, full_name, role, created_at, updated_at)
        VALUES(?,?,?,?,?,?)
        """,
        (user_id, "", "", role or "customer", now_iso(), now_iso()),
    )


def telegram_api_post(method, payload):
    if not TOKEN:
        logging.info("Telegram %s skipped: bot token is empty chat_id=%s", method, payload.get("chat_id"))
        return
    logging.info(
        "Telegram %s queued chat_id=%s text=%s",
        method,
        payload.get("chat_id"),
        str(payload.get("text") or "")[:160],
    )

    def worker():
        try:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{TOKEN}/{method}",
                data=raw,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=8).read()
            logging.info("Telegram %s sent chat_id=%s", method, payload.get("chat_id"))
        except Exception as exc:
            logging.warning("Telegram %s failed chat_id=%s error=%s", method, payload.get("chat_id"), exc)

    threading.Thread(target=worker, daemon=True).start()


def notify_user(user_id, text, role=None, order_id=None, view=None):
    if not user_id:
        return
    payload = {"chat_id": int(user_id), "text": text}
    telegram_api_post("sendMessage", payload)


def telegram_file_content(file_id):
    if not TOKEN or not file_id:
        return None, None
    try:
        get_file_url = f"https://api.telegram.org/bot{TOKEN}/getFile?file_id={quote(str(file_id), safe='')}"
        file_info = json.loads(urllib.request.urlopen(get_file_url, timeout=8).read().decode("utf-8"))
        file_path = ((file_info.get("result") or {}).get("file_path") or "").lstrip("/")
        if not file_path:
            return None, None
        raw = urllib.request.urlopen(f"https://api.telegram.org/file/bot{TOKEN}/{file_path}", timeout=12).read()
        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        return raw, content_type
    except Exception as exc:
        logging.warning("Telegram file fetch failed file_id=%s error=%s", file_id, exc)
        return None, None


def user_public(user):
    if not user:
        return None
    rating, reviews_count = user_rating(user["id"])
    customer = db_one("SELECT * FROM customers WHERE user_id=?", (user["id"],))
    executor = db_one("SELECT * FROM executors WHERE user_id=?", (user["id"],))
    data = {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "company": user["company"],
        "city": user["city"],
        "phone": user["phone"],
        "email": user["email"],
        "specialization": user["specialization"],
        "description": user["description"],
        "work_status": user["work_status"],
        "rating": rating,
        "reviews_count": reviews_count,
    }
    if customer:
        data["company"] = customer["company"] or data["company"]
        data["city"] = customer["city"] or data["city"]
        data["phone"] = customer["phone"] or data["phone"]
        data["customer_type"] = customer["customer_type"]
    if executor:
        data["company"] = executor["company"] or data["company"]
        data["city"] = executor["city"] or data["city"]
        data["phone"] = executor["phone"] or data["phone"]
        data["email"] = executor["email"] or data["email"]
        data["specialization"] = executor["specialization"] or data["specialization"]
        data["description"] = executor["description"] or data["description"]
        data["work_status"] = executor["work_status"] or data["work_status"]
    return data


def order_public(order):
    data = row_dict(order)
    if not data:
        return None
    return normalize_order_public(data, data["id"])


def normalize_order_public(data, order_id):
    data["status"] = api_status(data.get("status"))
    data["quantity"] = data.get("quantity") or 0
    raw_file_id = data.get("file_id") or data.get("photo_id") or data.get("file_preview") or ""
    data["has_file"] = bool(raw_file_id)
    if isinstance(raw_file_id, str) and raw_file_id.startswith("data:"):
        data["file_url"] = f"/api/orders/file?order_id={order_id}"
        if raw_file_id.startswith("data:image/"):
            data["file_type"] = "image_data"
        elif raw_file_id.startswith("data:application/pdf"):
            data["file_type"] = "pdf"
        data["file_id"] = ""
        data["photo_id"] = ""
        data["file_preview"] = "чертеж прикреплен"
    elif raw_file_id and not str(raw_file_id).startswith(("http://", "https://")):
        data["file_url"] = f"/api/orders/file?order_id={order_id}"
        data["file_id"] = ""
        data["photo_id"] = ""
        data["file_preview"] = "чертеж прикреплен"
    else:
        data["file_url"] = ""
        data["file_id"] = raw_file_id
        data["photo_id"] = raw_file_id
    data["executor_id"] = data.get("executor_id") or data.get("selected_executor_id")
    return data


def offer_public(offer):
    data = row_dict(offer)
    if not data:
        return None
    data["status"] = api_offer_status(data.get("status"))
    if "file_id" in data or "photo_id" in data or "file_preview" in data:
        data = normalize_order_public(data, data.get("order_id") or data.get("id"))
        data["status"] = api_offer_status(offer["status"])
    return data


def customer_dashboard(user_id):
    active = db_one(
        "SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=? AND status IN ('new','work')",
        (user_id,),
    )["cnt"]
    pending = db_one(
        """
        SELECT COUNT(*) AS cnt
        FROM offers
        JOIN orders ON orders.id=offers.order_id
        WHERE orders.customer_id=? AND offers.status='new'
        """,
        (user_id,),
    )["cnt"]
    favorites = db_one("SELECT COUNT(*) AS cnt FROM favorites WHERE user_id=?", (user_id,))["cnt"]
    week_rows = db_all(
        """
        SELECT strftime('%w', created_at) AS weekday, COUNT(*) AS cnt
        FROM orders
        WHERE customer_id=? AND datetime(created_at) >= datetime('now', '-6 days')
        GROUP BY weekday
        """,
        (user_id,),
    )
    week = [0, 0, 0, 0, 0, 0, 0]
    for row in week_rows:
        index = (int(row["weekday"]) + 6) % 7
        week[index] = row["cnt"]
    return {
        "active_orders_count": active,
        "pending_offers_count": pending,
        "favorites_count": favorites,
        "week": week,
    }


def executor_dashboard(user_id):
    open_count = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE status='new'")["cnt"]
    active = db_one(
        "SELECT COUNT(*) AS cnt FROM orders WHERE executor_id=? AND status='work'",
        (user_id,),
    )["cnt"]
    completed = db_one(
        """
        SELECT COUNT(*) AS cnt FROM orders
        WHERE executor_id=? AND status='done'
          AND strftime('%Y-%m', created_at)=strftime('%Y-%m', 'now')
        """,
        (user_id,),
    )["cnt"]
    rating, _ = user_rating(user_id)
    return {
        "open_orders_count": open_count,
        "active_orders_count": active,
        "completed_month_count": completed,
        "rating": rating,
        "stats": executor_stats(user_id),
    }


def customer_orders(user_id, limit=20, offset=0):
    rows = db_all(
        """
        SELECT orders.*,
               (SELECT COUNT(*) FROM offers WHERE offers.order_id=orders.id) AS offers_count
        FROM orders
        WHERE customer_id=?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        (user_id, limit, offset),
    )
    return [order_public(row) for row in rows]


def open_orders(limit=20, offset=0):
    rows = db_all(
        """
        SELECT orders.*,
               users.company AS customer_name,
               users.full_name AS customer_full_name,
               users.city AS customer_city
        FROM orders
        LEFT JOIN users ON users.id=orders.customer_id
        WHERE orders.status='new'
        ORDER BY orders.id DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    return [order_public(row) for row in rows]


def can_access_order_chat(user_id, order):
    executor_id = (order["executor_id"] or order["selected_executor_id"]) if order else 0
    return bool(
        order
        and user_id
        and order["customer_id"]
        and executor_id
        and user_id in {order["customer_id"], executor_id}
    )


def chat_peer_id(sender_id, order):
    selected_executor_id = order["executor_id"] or order["selected_executor_id"]
    if sender_id == order["customer_id"]:
        return selected_executor_id
    if sender_id == selected_executor_id:
        return order["customer_id"]
    return 0


def customer_offers(user_id):
    rows = db_all(
        """
        SELECT offers.*, orders.title AS order_title, orders.customer_id,
               users.company AS executor_company, users.city AS executor_city
        FROM offers
        JOIN orders ON orders.id=offers.order_id
        LEFT JOIN users ON users.id=offers.executor_id
        WHERE orders.customer_id=?
        ORDER BY offers.id DESC
        """,
        (user_id,),
    )
    return [offer_public(row) for row in rows]


def executor_offers(user_id):
    rows = db_all(
        """
        SELECT offers.*, orders.title AS order_title, orders.city, orders.budget,
               orders.material, orders.quantity, orders.deadline AS order_deadline,
               orders.customer_id, orders.executor_id, orders.selected_executor_id,
               orders.file_id, orders.photo_id, orders.file_preview, orders.file_type
        FROM offers
        JOIN orders ON orders.id=offers.order_id
        WHERE offers.executor_id=?
        ORDER BY offers.id DESC
        """,
        (user_id,),
    )
    return [offer_public(row) for row in rows]


def favorite_executors(user_id):
    rows = db_all(
        """
        SELECT users.*
        FROM favorites
        JOIN users ON users.id=favorites.target_id
        WHERE favorites.user_id=?
        ORDER BY favorites.created_at DESC
        """,
        (user_id,),
    )
    return [user_public(row) for row in rows]


def executor_list():
    rows = db_all(
        """
        SELECT * FROM users
        WHERE role='executor'
        ORDER BY company IS NULL, company, full_name
        LIMIT 100
        """
    )
    return [user_public(row) for row in rows]


def portfolio(user_id):
    return rows_dict(
        db_all(
            """
            SELECT id, file_id, file_type,
                   COALESCE(description, '') AS description,
                   COALESCE(description, '') AS title,
                   COALESCE(equipment, '') AS equipment,
                   created_at
            FROM portfolio
            WHERE user_id=?
            ORDER BY id DESC
            """,
            (user_id,),
        )
    )


def reviews_for(user_id):
    return rows_dict(
        db_all(
            """
            SELECT reviews.*, users.company AS author_company, users.full_name AS author_name
            FROM reviews
            LEFT JOIN users ON users.id=reviews.from_user_id
            WHERE reviews.to_user_id=?
            ORDER BY reviews.id DESC
            LIMIT 20
            """,
            (user_id,),
        )
    )


def calendar(user_id):
    rows = db_all("SELECT day, status FROM executor_calendar WHERE user_id=?", (user_id,))
    return {row["day"]: row["status"] for row in rows}


def messages_for(user_id, order_id=0):
    if not order_id:
        return []
    params = [user_id, user_id, user_id, user_id, user_id, order_id]
    return rows_dict(
        db_all(
            """
            SELECT messages.*,
                   messages.from_user_id AS sender_id,
                   messages.to_user_id AS receiver_id
            FROM messages
            JOIN orders ON orders.id=messages.order_id
            WHERE (orders.customer_id=?
               OR orders.selected_executor_id=?
               OR orders.executor_id=?
               OR messages.from_user_id=?
               OR messages.to_user_id=?)
              AND messages.order_id=?
            ORDER BY messages.id
            """,
            tuple(params),
        )
    )


def profile_for(user_id):
    return user_public(db_one("SELECT * FROM users WHERE id=?", (user_id,))) or {}


def bootstrap(user_id, role):
    actual_user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
    if actual_user and actual_user["role"] in {"customer", "executor"}:
        role = actual_user["role"]
    if role == "executor":
        dashboard = executor_dashboard(user_id)
        return {
            "role": role,
            "profile": profile_for(user_id),
            "dashboard": dashboard,
            "week": [0, 0, 0, 0, 0, 0, 0],
            "orders": open_orders(20, 0),
            "offers": executor_offers(user_id),
            "notifications": [],
            "calendar": calendar(user_id),
            "portfolio": portfolio(user_id),
            "reviews": reviews_for(user_id),
            "stats": dashboard.get("stats") or executor_stats(user_id),
        }
    dashboard = customer_dashboard(user_id)
    return {
        "role": role,
        "profile": profile_for(user_id),
        "dashboard": dashboard,
        "week": dashboard["week"],
            "orders": customer_orders(user_id, 20, 0),
        "offers": customer_offers(user_id),
        "executors": executor_list(),
        "favorites": favorite_executors(user_id),
        "messages": [],
        "notifications": [],
    }


def executor_stats(user_id):
    completed = db_one(
        "SELECT COUNT(*) AS cnt FROM orders WHERE executor_id=? AND status='done'",
        (user_id,),
    )["cnt"]
    accepted = db_one("SELECT COUNT(*) AS cnt FROM offers WHERE executor_id=? AND status='accepted'", (user_id,))["cnt"]
    sent = db_one("SELECT COUNT(*) AS cnt FROM offers WHERE executor_id=?", (user_id,))["cnt"]
    prices = db_all(
        """
        SELECT offers.price FROM offers
        JOIN orders ON orders.id=offers.order_id
        WHERE offers.executor_id=? AND orders.status='done'
        """,
        (user_id,),
    )
    amounts = []
    for row in prices:
        digits = "".join(ch if ch.isdigit() else " " for ch in row["price"] or "")
        numbers = [int(part) for part in digits.split() if part.isdigit()]
        if numbers:
            amounts.append(numbers[0])
    total = sum(amounts)
    return {
        "completed_orders": completed,
        "average_check": int(total / len(amounts)) if amounts else 0,
        "total_earned": total,
        "offers_sent": sent,
        "offers_accepted": accepted,
        "conversion": accepted / sent if sent else 0,
    }


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "MetalConnectAPI/1.0"
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        log_request(self, "OPTIONS", parsed.path)
        self.send_json({})

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            user_id = request_user_id(self, query=query)
            path = parsed.path
            log_request(self, "GET", path, user_id)

            if path == "/api/me":
                requested_role = (query.get("role") or [""])[0]
                user = db_one("SELECT * FROM users WHERE id=?", (user_id,))
                if not user and requested_role in {"customer", "executor"}:
                    ensure_user(user_id, requested_role)
                    user = db_one("SELECT * FROM users WHERE id=?", (user_id,))
                cache_key = ("me", user_id, requested_role)
                if cache_key in RESPONSE_CACHE:
                    self.send_json(RESPONSE_CACHE[cache_key])
                    return
                data = {"user": user_public(user), "role": user["role"] if user else None}
                RESPONSE_CACHE[cache_key] = data
                self.send_json(data)
                return
            if path == "/api/dashboard/customer":
                cache_key = ("dashboard_customer", user_id)
                data = RESPONSE_CACHE.get(cache_key)
                if data is None:
                    data = customer_dashboard(user_id)
                    RESPONSE_CACHE[cache_key] = data
                self.send_json(data)
                return
            if path == "/api/dashboard/executor":
                cache_key = ("dashboard_executor", user_id)
                data = RESPONSE_CACHE.get(cache_key)
                if data is None:
                    data = executor_dashboard(user_id)
                    RESPONSE_CACHE[cache_key] = data
                self.send_json(data)
                return
            if path == "/api/orders/file":
                order_id = int_param(query, "order_id")
                order = db_one("SELECT file_id, photo_id, file_preview, file_type FROM orders WHERE id=?", (order_id,))
                if not order:
                    self.send_error_json(404, "File not found")
                    return
                value = order["file_id"] or order["photo_id"] or order["file_preview"] or ""
                mime, payload = data_url_parts(value)
                if mime and payload:
                    self.send_bytes(base64.b64decode(payload), mime)
                    return
                if isinstance(value, str) and value.startswith(("http://", "https://")):
                    self.send_redirect(value)
                    return
                raw, content_type = telegram_file_content(value)
                if raw:
                    self.send_bytes(raw, content_type)
                    return
                self.send_json({"file_id": value, "file_type": order["file_type"] or ""})
                return
            if path == "/api/orders/customer":
                limit, offset = page_params(query)
                orders = customer_orders(user_id, limit, offset)
                self.send_json({"orders": orders, "limit": limit, "offset": offset, "has_more": len(orders) == limit})
                return
            if path == "/api/orders/open":
                limit, offset = page_params(query)
                orders = open_orders(limit, offset)
                self.send_json({"orders": orders, "limit": limit, "offset": offset, "has_more": len(orders) == limit})
                return
            if path == "/api/offers/customer":
                self.send_json({"offers": customer_offers(user_id)})
                return
            if path == "/api/offers/executor":
                self.send_json({"offers": executor_offers(user_id)})
                return
            if path == "/api/favorites":
                self.send_json({"favorites": favorite_executors(user_id)})
                return
            if path == "/api/executors":
                self.send_json({"executors": executor_list()})
                return
            if path == "/api/portfolio":
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user or user["role"] != "executor":
                    self.send_error_json(403, "Portfolio is available only to executor")
                    return
                self.send_json({"portfolio": portfolio(user_id)})
                return
            if path == "/api/reviews":
                self.send_json({"reviews": reviews_for(user_id)})
                return
            if path == "/api/calendar":
                self.send_json({"calendar": calendar(user_id)})
                return
            if path == "/api/stats/executor":
                self.send_json(executor_stats(user_id))
                return
            if path in {"/api/messages", "/api/chat/messages"}:
                order_id = int_param(query, "order_id")
                if not order_id:
                    self.send_json({"messages": []})
                    return
                order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
                if not can_access_order_chat(user_id, order):
                    self.send_error_json(403, "Chat is available only to order participants")
                    return
                self.send_json({"messages": messages_for(user_id, order_id)})
                return
            if path == "/api/get_ngrok_url":
                url = public_api_url()
                self.send_json({
                    "url": url,
                    "github_redirect_uri": github_redirect_uri(),
                })
                return
            if path == "/api/bootstrap":
                requested_role = (query.get("role") or [""])[0]
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user and requested_role in {"customer", "executor"}:
                    ensure_user(user_id, requested_role)
                    user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                elif user and not user["role"] and requested_role in {"customer", "executor"}:
                    db_execute("UPDATE users SET role=?, updated_at=? WHERE id=?", (requested_role, now_iso(), user_id))
                    user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                role = user["role"] if user and user["role"] in {"customer", "executor"} else requested_role
                if role not in {"customer", "executor"}:
                    role = "customer"
                cache_key = ("bootstrap", user_id, role)
                data = RESPONSE_CACHE.get(cache_key)
                if data is None:
                    data = bootstrap(user_id, role)
                    RESPONSE_CACHE[cache_key] = data
                self.send_json(data)
                return

            self.send_error_json(404, "Not found")
        except Exception as exc:
            logging.exception("API GET failed")
            self.send_error_json(500, str(exc))

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            body = body_json(self)
            path = parsed.path
            user_id = request_user_id(self, body=body)
            log_request(self, "POST", path, user_id, body)
            clear_cache()

            if path == "/api/orders/create":
                requested_role = body.get("role") if body.get("role") in {"customer", "executor"} else None
                if requested_role == "executor":
                    self.send_error_json(403, "Only customer can create order")
                    return
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user:
                    ensure_user(user_id, "customer")
                elif user["role"] != "customer":
                    self.send_error_json(403, "Only customer can create order")
                    return
                file_id = body.get("file_id") or body.get("photo_id") or ""
                file_type = body.get("file_type") or ("image_data" if str(file_id).startswith("data:image/") else "")
                order_id = db_execute(
                    """
                    INSERT INTO orders(customer_id, title, description, budget, city, deadline,
                                       payment_terms, status, created_at, updated_at,
                                       material, quantity, urgency, file_preview,
                                       photo_id, file_id, file_type)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        user_id,
                        body["title"].strip(),
                        body.get("desc") or body.get("description") or "",
                        body.get("budget") or "Договорной",
                        body.get("city") or "",
                        body.get("deadline") or "",
                        body.get("payment_terms") or "Не указано",
                        "new",
                        now_iso(),
                        now_iso(),
                        body.get("material") or "",
                        int(body.get("quantity") or 0),
                        body.get("urgency") or "",
                        file_id,
                        file_id,
                        file_id,
                        file_type,
                    ),
                )
                if file_id:
                    db_execute(
                        """
                        INSERT INTO order_files(order_id, file_id, file_type, caption, created_at)
                        VALUES(?,?,?,?,?)
                        """,
                        (order_id, file_id, file_type or "file", body.get("title") or "", now_iso()),
                    )
                self.send_json({"ok": True, "order_id": order_id})
                return

            if path == "/api/orders/update":
                order_id = int(body["order_id"])
                order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (order_id, user_id))
                if not order:
                    self.send_error_json(404, "Order not found")
                    return
                if order["status"] != "new":
                    self.send_error_json(400, "Only open order can be edited")
                    return
                fields = {
                    "title": body.get("title"),
                    "description": body.get("description") or body.get("desc"),
                    "budget": body.get("budget"),
                    "city": body.get("city"),
                    "deadline": body.get("deadline"),
                    "payment_terms": body.get("payment_terms"),
                    "material": body.get("material"),
                    "quantity": body.get("quantity"),
                    "urgency": body.get("urgency"),
                    "file_id": body.get("file_id") or body.get("photo_id"),
                    "photo_id": body.get("photo_id") or body.get("file_id"),
                    "file_preview": body.get("file_id") or body.get("photo_id"),
                    "file_type": body.get("file_type"),
                }
                sets = []
                params = []
                for name, value in fields.items():
                    if value is not None:
                        sets.append(f"{name}=?")
                        params.append(value)
                if sets:
                    sets.append("updated_at=?")
                    params.append(now_iso())
                    params.append(order_id)
                    db_execute(f"UPDATE orders SET {', '.join(sets)} WHERE id=?", tuple(params))
                self.send_json({"ok": True})
                return

            if path == "/api/orders/cancel":
                order_id = int(body["order_id"])
                order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (order_id, user_id))
                if not order:
                    self.send_error_json(404, "Order not found")
                    return
                if order["status"] in {"done", "cancelled"}:
                    self.send_error_json(400, "Order is already closed")
                    return
                db_execute("UPDATE orders SET status='cancelled', updated_at=? WHERE id=?", (now_iso(), order_id))
                self.send_json({"ok": True})
                return

            if path == "/api/set_ngrok_url":
                url = set_ngrok_url(body.get("url"))
                self.send_json({
                    "ok": True,
                    "url": url,
                    "github_redirect_uri": github_redirect_uri(),
                })
                return

            if path == "/api/offers/create":
                order_id = int(body["order_id"])
                order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
                if not order:
                    self.send_error_json(404, "Order not found")
                    return
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user or user["role"] != "executor":
                    self.send_error_json(403, "Only executor can create offer")
                    return
                if order["customer_id"] == user_id:
                    self.send_error_json(400, "Cannot create offer for own order")
                    return
                if not order_is_open(order["status"]):
                    self.send_error_json(400, "Order is not open for offers")
                    return
                existing_offer = db_one(
                    "SELECT id, status FROM offers WHERE order_id=? AND executor_id=?",
                    (order_id, user_id),
                )
                if existing_offer and offer_is_pending(existing_offer["status"]):
                    self.send_error_json(409, "Pending offer already exists")
                    return
                if existing_offer and existing_offer["status"] == "accepted":
                    self.send_error_json(409, "Offer is already accepted")
                    return
                offer_values = (
                    order_id,
                    user_id,
                    str(body.get("price") or ""),
                    str(body.get("deadline") or body.get("deadline_days") or ""),
                    body.get("comment") or "",
                    "new",
                    now_iso(),
                )
                if existing_offer:
                    offer_id = existing_offer["id"]
                    db_execute(
                        """
                        UPDATE offers
                        SET price=?, deadline=?, comment=?, status='new', created_at=?
                        WHERE id=?
                        """,
                        (offer_values[2], offer_values[3], offer_values[4], offer_values[6], offer_id),
                    )
                else:
                    offer_id = db_execute(
                        """
                        INSERT INTO offers(order_id, executor_id, price, deadline, comment, status, created_at)
                        VALUES(?,?,?,?,?,?,?)
                        """,
                        offer_values,
                    )
                notify_user(
                    order["customer_id"],
                    f"Новое предложение по заказу №{order['id']} «{order['title']}»: {body.get('price') or 'цена не указана'}.",
                    "customer",
                    order["id"],
                    "offersView",
                )
                self.send_json({"ok": True, "offer_id": offer_id})
                return

            if path == "/api/offers/accept":
                offer_id = int(body["offer_id"])
                offer = db_one("SELECT * FROM offers WHERE id=?", (offer_id,))
                if not offer:
                    self.send_error_json(404, "Offer not found")
                    return
                order_id = int(body.get("order_id") or offer["order_id"])
                executor_id = int(body.get("executor_id") or offer["executor_id"])
                order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (order_id, user_id))
                if not order:
                    self.send_error_json(403, "Offer can be accepted only by order customer")
                    return
                if not order_is_open(order["status"]):
                    self.send_error_json(400, "Only open order can accept offer")
                    return
                if not offer_is_pending(offer["status"]):
                    self.send_error_json(400, "Only pending offer can be accepted")
                    return
                db_execute("UPDATE offers SET status='accepted' WHERE id=?", (offer_id,))
                db_execute("UPDATE offers SET status='declined' WHERE order_id=? AND id!=?", (order_id, offer_id))
                db_execute(
                    """
                    UPDATE orders
                    SET selected_executor_id=?, executor_id=?, status='work', updated_at=?
                    WHERE id=?
                    """,
                    (executor_id, executor_id, now_iso(), order_id),
                )
                notify_user(
                    executor_id,
                    f"Ваше предложение по заказу #{order_id} принято. Откройте чат по заказу.",
                    "executor",
                    order_id,
                    "chatView",
                )
                self.send_json({"ok": True})
                return

            if path == "/api/offers/decline":
                offer_id = int(body["offer_id"])
                offer = db_one("SELECT * FROM offers WHERE id=?", (offer_id,))
                if offer:
                    order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (offer["order_id"], user_id))
                    if not order:
                        self.send_error_json(403, "Offer can be declined only by order customer")
                        return
                    if not order_is_open(order["status"]) or not offer_is_pending(offer["status"]):
                        self.send_error_json(400, "Only pending offer on open order can be declined")
                        return
                db_execute("UPDATE offers SET status='declined' WHERE id=?", (offer_id,))
                if offer:
                    notify_user(
                        offer["executor_id"],
                        f"Ваше предложение по заказу #{offer['order_id']} отклонено.",
                        "executor",
                        offer["order_id"],
                        "ordersView",
                    )
                self.send_json({"ok": True})
                return

            if path == "/api/orders/complete":
                order_id = int(body["order_id"])
                order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (order_id, user_id))
                if not order:
                    self.send_error_json(403, "Order can be completed only by customer")
                    return
                if not order_is_in_progress(order["status"]):
                    self.send_error_json(400, "Only order in progress can be completed")
                    return
                db_execute(
                    "UPDATE orders SET status='done', updated_at=? WHERE id=?",
                    (now_iso(), order_id),
                )
                if order["selected_executor_id"] or order["executor_id"]:
                    notify_user(
                        order["selected_executor_id"] or order["executor_id"],
                        f"Заказ #{order_id} завершен. Заказчик может оставить отзыв.",
                        "executor",
                        order_id,
                        "ordersView",
                    )
                self.send_json({"ok": True})
                return

            if path == "/api/favorites/add":
                path = "/api/favorites"
            if path == "/api/favorites":
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user or user["role"] != "customer":
                    self.send_error_json(403, "Only customer can add executor to favorites")
                    return
                executor = db_one("SELECT id FROM users WHERE id=? AND role='executor'", (int(body["executor_id"]),))
                if not executor:
                    self.send_error_json(404, "Executor not found")
                    return
                db_execute(
                    "INSERT OR IGNORE INTO favorites(user_id, target_id, created_at) VALUES(?,?,?)",
                    (user_id, int(body["executor_id"]), now_iso()),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/portfolio/add":
                path = "/api/portfolio"
            if path == "/api/portfolio":
                user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                if not user or user["role"] != "executor":
                    self.send_error_json(403, "Portfolio is available only to executor")
                    return
                file_id = body.get("file_id") or body.get("photo_id") or ""
                if not file_id:
                    self.send_error_json(400, "Portfolio photo is required")
                    return
                description = body.get("description") or body.get("text") or body.get("caption") or ""
                equipment = body.get("equipment") or ""
                portfolio_id = db_execute(
                    """
                    INSERT INTO portfolio(user_id, file_id, file_type, description, equipment, created_at)
                    VALUES(?,?,?,?,?,?)
                    """,
                    (user_id, file_id, body.get("file_type") or "photo", description, equipment, now_iso()),
                )
                db_execute(
                    """
                    INSERT INTO portfolio_files(executor_id, file_id, file_type, caption, description, equipment, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (user_id, file_id, body.get("file_type") or "photo", description, description, equipment, now_iso()),
                )
                self.send_json({"ok": True, "portfolio_id": portfolio_id})
                return

            if path == "/api/calendar/set":
                path = "/api/calendar"
            if path == "/api/calendar":
                db_execute(
                    """
                    INSERT INTO executor_calendar(user_id, day, status, updated_at)
                    VALUES(?,?,?,?)
                    ON CONFLICT(user_id, day) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
                    """,
                    (user_id, str(body["day"]), body.get("status") or "free", now_iso()),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/profile/update":
                requested_role = body.get("role") if body.get("role") in {"customer", "executor"} else None
                ensure_user(user_id, requested_role)
                actual_user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                role = actual_user["role"] if actual_user and actual_user["role"] in {"customer", "executor"} else requested_role
                if role not in {"customer", "executor"}:
                    role = "customer"
                db_execute(
                    """
                    UPDATE users
                    SET company=COALESCE(?, company), city=COALESCE(?, city),
                        phone=COALESCE(?, phone), specialization=COALESCE(?, specialization),
                        work_status=COALESCE(?, work_status), updated_at=?
                    WHERE id=?
                    """,
                    (
                        body.get("company"),
                        body.get("city"),
                        body.get("phone"),
                        body.get("specialization"),
                        body.get("work_schedule") or body.get("work_status"),
                        now_iso(),
                        user_id,
                    ),
                )
                if role == "executor":
                    db_execute(
                        """
                        INSERT INTO executors(user_id, company, city, phone, email, specialization,
                                              description, work_status, created_at, updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET
                            company=COALESCE(excluded.company, executors.company),
                            city=COALESCE(excluded.city, executors.city),
                            phone=COALESCE(excluded.phone, executors.phone),
                            email=COALESCE(excluded.email, executors.email),
                            specialization=COALESCE(excluded.specialization, executors.specialization),
                            description=COALESCE(excluded.description, executors.description),
                            work_status=COALESCE(excluded.work_status, executors.work_status),
                            updated_at=excluded.updated_at
                        """,
                        (
                            user_id,
                            body.get("company"),
                            body.get("city"),
                            body.get("phone"),
                            body.get("email"),
                            body.get("specialization"),
                            body.get("description"),
                            body.get("work_schedule") or body.get("work_status"),
                            now_iso(),
                            now_iso(),
                        ),
                    )
                    db_execute(
                        """
                        UPDATE users
                        SET description=COALESCE(?, description), email=COALESCE(?, email), updated_at=?
                        WHERE id=?
                        """,
                        (body.get("description"), body.get("email"), now_iso(), user_id),
                    )
                if body.get("customer_type") is not None or role == "customer":
                    db_execute(
                        """
                        INSERT INTO customers(user_id, company, city, phone, customer_type, created_at, updated_at)
                        VALUES(?,?,?,?,?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET
                            company=COALESCE(excluded.company, customers.company),
                            city=COALESCE(excluded.city, customers.city),
                            phone=COALESCE(excluded.phone, customers.phone),
                            customer_type=COALESCE(excluded.customer_type, customers.customer_type),
                            updated_at=excluded.updated_at
                        """,
                        (
                            user_id,
                            body.get("company"),
                            body.get("city"),
                            body.get("phone"),
                            body.get("customer_type"),
                            now_iso(),
                            now_iso(),
                        ),
                    )
                self.send_json({"ok": True, "profile": profile_for(user_id)})
                return

            if path in {"/api/reviews/add", "/api/reviews"}:
                order_id = int(body["order_id"])
                stars = max(1, min(5, int(body.get("stars") or 5)))
                order = db_one("SELECT * FROM orders WHERE id=? AND customer_id=?", (order_id, user_id))
                if not order:
                    self.send_error_json(403, "Review can be created only by order customer")
                    return
                if (order["status"] or "") not in {"done", "completed"}:
                    self.send_error_json(400, "Review is available only for completed order")
                    return
                executor_id = order["selected_executor_id"] or order["executor_id"]
                if not executor_id:
                    self.send_error_json(400, "Order executor is not selected")
                    return
                db_execute(
                    """
                    INSERT INTO reviews(order_id, from_user_id, to_user_id, stars, text, created_at)
                    VALUES(?,?,?,?,?,?)
                    ON CONFLICT(order_id, from_user_id, to_user_id)
                    DO UPDATE SET stars=excluded.stars, text=excluded.text, created_at=excluded.created_at
                    """,
                    (order_id, user_id, executor_id, stars, body.get("text") or "", now_iso()),
                )
                notify_user(
                    executor_id,
                    f"Новый отзыв по заказу #{order_id}: {stars}★.",
                    "executor",
                    order_id,
                    "profileView",
                )
                self.send_json({"ok": True})
                return

            if path == "/api/messages/create":
                path = "/api/chat/messages"
            if path == "/api/chat/upload":
                path = "/api/chat/messages"
            if path == "/api/chat/messages":
                order = db_one("SELECT * FROM orders WHERE id=?", (int(body["order_id"]),))
                if not order:
                    self.send_error_json(404, "Order not found")
                    return
                executor_id = order["executor_id"] or order["selected_executor_id"]
                if not order["customer_id"] or not executor_id:
                    self.send_error_json(400, "Both chat participants must be selected")
                    return
                sender_id = user_id
                if sender_id not in {order["customer_id"], executor_id}:
                    self.send_error_json(403, "Chat is available only to order participants")
                    return
                receiver_id = chat_peer_id(sender_id, order)
                if not receiver_id:
                    self.send_error_json(400, "Second chat participant is not selected yet")
                    return
                if sender_id == receiver_id:
                    self.send_error_json(400, "Second chat participant is not selected yet")
                    return
                message_id = db_execute(
                    """
                    INSERT INTO messages(order_id, from_user_id, to_user_id, text, file_id, file_type, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        int(body["order_id"]),
                        sender_id,
                        int(receiver_id),
                        body.get("text") or "",
                        body.get("file_id") or body.get("photo_id") or "",
                        body.get("file_type") or "",
                        now_iso(),
                    ),
                )
                db_execute(
                    """
                    INSERT INTO chat_messages(order_id, sender_id, receiver_id, text, file_id, file_type, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        int(body["order_id"]),
                        sender_id,
                        int(receiver_id),
                        body.get("text") or "",
                        body.get("file_id") or body.get("photo_id") or "",
                        body.get("file_type") or "",
                        now_iso(),
                    ),
                )
                notify_user(
                    receiver_id,
                    f"Новое сообщение по заказу #{order['id']}.",
                    "executor" if receiver_id in {order["selected_executor_id"], order["executor_id"]} else "customer",
                    order["id"],
                    "chatView",
                )
                self.send_json({"ok": True, "message_id": message_id})
                return

            self.send_error_json(404, "Not found")
        except Exception as exc:
            logging.exception("API POST failed")
            self.send_error_json(500, str(exc))

    def do_DELETE(self):
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            user_id = request_user_id(self, query=query)
            log_request(self, "DELETE", parsed.path, user_id)
            clear_cache()
            if parsed.path in {"/api/favorites/remove", "/api/favorites"}:
                executor_id = int_param(query, "executor_id")
                if not executor_id:
                    executor_id = int_param(query, "target_id")
                db_execute("DELETE FROM favorites WHERE user_id=? AND target_id=?", (user_id, executor_id))
                self.send_json({"ok": True})
                return
            if parsed.path in {"/api/portfolio/remove", "/api/portfolio"}:
                portfolio_id = int_param(query, "portfolio_id")
                if not portfolio_id:
                    portfolio_id = int_param(query, "id")
                item = db_one("SELECT file_id, created_at FROM portfolio WHERE id=? AND user_id=?", (portfolio_id, user_id))
                db_execute(
                    "DELETE FROM portfolio WHERE id=? AND user_id=?",
                    (portfolio_id, user_id),
                )
                if item:
                    db_execute(
                        "DELETE FROM portfolio_files WHERE executor_id=? AND file_id=? AND created_at=?",
                        (user_id, item["file_id"], item["created_at"]),
                    )
                self.send_json({"ok": True})
                return
            self.send_error_json(404, "Not found")
        except Exception as exc:
            logging.exception("API DELETE failed")
            self.send_error_json(500, str(exc))

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        allow_origin = "*"
        logging.info(
            "API response method=%s path=%s status=%s bytes=%s cors_origin=%s",
            self.command,
            urlparse(self.path).path,
            status,
            len(raw),
            allow_origin,
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", allow_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data, ngrok-skip-browser-warning")
        self.send_header("Connection", "keep-alive")
        self.send_header("Vary", "Origin")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except BrokenPipeError:
            logging.info("Client disconnected, ignoring broken pipe")

    def send_bytes(self, raw, content_type="application/octet-stream", status=200):
        allow_origin = "*"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Access-Control-Allow-Origin", allow_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data, ngrok-skip-browser-warning")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except BrokenPipeError:
            logging.info("Client disconnected during binary response, ignoring broken pipe")

    def send_redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

    def send_error_json(self, status, message):
        self.send_json({"ok": False, "error": message}, status)

    def log_message(self, fmt, *args):
        logging.info("API %s - %s", self.address_string(), fmt % args)


def run_api():
    logging.basicConfig(level=logging.INFO)
    init_db()
    load_ngrok_url()
    server = ThreadingHTTPServer((API_HOST, API_PORT), ApiHandler)
    logging.info("METAL CONNECT API started on http://%s:%s", API_HOST, API_PORT)
    server.serve_forever()


if __name__ == "__main__":
    run_api()
