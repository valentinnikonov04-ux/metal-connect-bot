import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from metal_connect_app.config import API_CORS_ORIGIN, API_HOST, API_PORT
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


def int_param(query, name, default=0):
    try:
        return int((query.get(name) or [default])[0] or default)
    except (TypeError, ValueError):
        return default


def body_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def user_public(user):
    if not user:
        return None
    rating, reviews_count = user_rating(user["id"])
    return {
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


def order_public(order):
    data = row_dict(order)
    if not data:
        return None
    data["status"] = api_status(data.get("status"))
    data["quantity"] = data.get("quantity") or 0
    return data


def offer_public(offer):
    data = row_dict(offer)
    if not data:
        return None
    data["status"] = api_offer_status(data.get("status"))
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
        "SELECT COUNT(*) AS cnt FROM orders WHERE selected_executor_id=? AND status='work'",
        (user_id,),
    )["cnt"]
    completed = db_one(
        """
        SELECT COUNT(*) AS cnt FROM orders
        WHERE selected_executor_id=? AND status='done'
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


def customer_orders(user_id):
    rows = db_all(
        """
        SELECT orders.*,
               (SELECT COUNT(*) FROM offers WHERE offers.order_id=orders.id) AS offers_count
        FROM orders
        WHERE customer_id=?
        ORDER BY id DESC
        """,
        (user_id,),
    )
    return [order_public(row) for row in rows]


def open_orders():
    rows = db_all(
        """
        SELECT orders.*, users.company AS customer_name, users.city AS customer_city
        FROM orders
        LEFT JOIN users ON users.id=orders.customer_id
        WHERE orders.status='new'
        ORDER BY orders.id DESC
        LIMIT 100
        """
    )
    return [order_public(row) for row in rows]


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
        SELECT offers.*, orders.title AS order_title, orders.city, orders.budget
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
            SELECT id, file_id, file_type, caption AS description, caption AS title, created_at
            FROM portfolio_files
            WHERE executor_id=?
            ORDER BY id DESC
            """,
            (user_id,),
        )
    )


def calendar(user_id):
    rows = db_all("SELECT day, status FROM executor_calendar WHERE user_id=?", (user_id,))
    return {row["day"]: row["status"] for row in rows}


def messages_for(user_id):
    return rows_dict(
        db_all(
            """
            SELECT chat_messages.*
            FROM chat_messages
            JOIN orders ON orders.id=chat_messages.order_id
            WHERE orders.customer_id=?
               OR orders.selected_executor_id=?
               OR chat_messages.sender_id=?
               OR chat_messages.receiver_id=?
            ORDER BY chat_messages.id
            """,
            (user_id, user_id, user_id, user_id),
        )
    )


def profile_for(user_id):
    return user_public(db_one("SELECT * FROM users WHERE id=?", (user_id,))) or {}


def bootstrap(user_id, role):
    if role == "executor":
        return {
            "role": role,
            "profile": profile_for(user_id),
            "dashboard": executor_dashboard(user_id),
            "week": [0, 0, 0, 0, 0, 0, 0],
            "orders": open_orders(),
            "offers": executor_offers(user_id),
            "notifications": [],
            "calendar": calendar(user_id),
            "portfolio": portfolio(user_id),
            "reviews": [],
            "stats": executor_stats(user_id),
        }
    return {
        "role": role,
        "profile": profile_for(user_id),
        "dashboard": customer_dashboard(user_id),
        "week": customer_dashboard(user_id)["week"],
        "orders": customer_orders(user_id),
        "offers": customer_offers(user_id),
        "executors": executor_list(),
        "favorites": favorite_executors(user_id),
        "messages": [],
        "notifications": [],
    }


def executor_stats(user_id):
    completed = db_one(
        "SELECT COUNT(*) AS cnt FROM orders WHERE selected_executor_id=? AND status='done'",
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

    def do_OPTIONS(self):
        self.send_json({})

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            user_id = int_param(query, "user_id")
            path = parsed.path

            if path == "/api/me":
                user = db_one("SELECT * FROM users WHERE id=?", (user_id,))
                self.send_json({"user": user_public(user), "role": user["role"] if user else None})
                return
            if path == "/api/dashboard/customer":
                self.send_json(customer_dashboard(user_id))
                return
            if path == "/api/dashboard/executor":
                self.send_json(executor_dashboard(user_id))
                return
            if path == "/api/orders/customer":
                self.send_json({"orders": customer_orders(user_id)})
                return
            if path == "/api/orders/open":
                self.send_json({"orders": open_orders()})
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
                self.send_json({"portfolio": portfolio(user_id)})
                return
            if path == "/api/calendar":
                self.send_json({"calendar": calendar(user_id)})
                return
            if path == "/api/messages":
                self.send_json({"messages": messages_for(user_id)})
                return
            if path == "/api/get_ngrok_url":
                url = public_api_url()
                self.send_json({
                    "url": url,
                    "github_redirect_uri": github_redirect_uri(),
                })
                return
            if path == "/api/bootstrap":
                role = (query.get("role") or [""])[0]
                if role not in {"customer", "executor"}:
                    user = db_one("SELECT role FROM users WHERE id=?", (user_id,))
                    role = user["role"] if user and user["role"] in {"customer", "executor"} else "customer"
                self.send_json(bootstrap(user_id, role))
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

            if path == "/api/orders/create":
                order_id = db_execute(
                    """
                    INSERT INTO orders(customer_id, title, description, budget, city, deadline,
                                       payment_terms, status, created_at, updated_at,
                                       material, quantity, urgency, file_preview)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        int(body["user_id"]),
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
                        body.get("photo_id") or body.get("file_id") or "",
                    ),
                )
                self.send_json({"ok": True, "order_id": order_id})
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
                offer_id = db_execute(
                    """
                    INSERT INTO offers(order_id, executor_id, price, deadline, comment, status, created_at)
                    VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(order_id, executor_id)
                    DO UPDATE SET price=excluded.price,
                                  deadline=excluded.deadline,
                                  comment=excluded.comment,
                                  status=offers.status,
                                  created_at=excluded.created_at
                    """,
                    (
                        int(body["order_id"]),
                        int(body["user_id"]),
                        str(body.get("price") or ""),
                        str(body.get("deadline") or body.get("deadline_days") or ""),
                        body.get("comment") or "",
                        "new",
                        now_iso(),
                    ),
                )
                if not offer_id:
                    offer = db_one(
                        "SELECT id FROM offers WHERE order_id=? AND executor_id=?",
                        (int(body["order_id"]), int(body["user_id"])),
                    )
                    offer_id = offer["id"] if offer else None
                self.send_json({"ok": True, "offer_id": offer_id})
                return

            if path == "/api/offers/accept":
                offer_id = int(body["offer_id"])
                order_id = int(body["order_id"])
                executor_id = int(body["executor_id"])
                db_execute("UPDATE offers SET status='accepted' WHERE id=?", (offer_id,))
                db_execute("UPDATE offers SET status='declined' WHERE order_id=? AND id!=?", (order_id, offer_id))
                db_execute(
                    "UPDATE orders SET selected_executor_id=?, status='work', updated_at=? WHERE id=?",
                    (executor_id, now_iso(), order_id),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/offers/decline":
                db_execute("UPDATE offers SET status='declined' WHERE id=?", (int(body["offer_id"]),))
                self.send_json({"ok": True})
                return

            if path == "/api/orders/complete":
                db_execute(
                    "UPDATE orders SET status='done', updated_at=? WHERE id=?",
                    (now_iso(), int(body["order_id"])),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/favorites/add":
                db_execute(
                    "INSERT OR IGNORE INTO favorites(user_id, target_id, created_at) VALUES(?,?,?)",
                    (int(body["user_id"]), int(body["executor_id"]), now_iso()),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/portfolio/add":
                file_id = body.get("file_id") or body.get("photo_id") or ""
                portfolio_id = db_execute(
                    """
                    INSERT INTO portfolio_files(executor_id, file_id, file_type, caption, created_at)
                    VALUES(?,?,?,?,?)
                    """,
                    (int(body["user_id"]), file_id, body.get("file_type") or "photo", body.get("text") or body.get("caption") or "", now_iso()),
                )
                self.send_json({"ok": True, "portfolio_id": portfolio_id})
                return

            if path == "/api/calendar/set":
                db_execute(
                    """
                    INSERT INTO executor_calendar(user_id, day, status, updated_at)
                    VALUES(?,?,?,?)
                    ON CONFLICT(user_id, day) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
                    """,
                    (int(body["user_id"]), str(body["day"]), body.get("status") or "free", now_iso()),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/profile/update":
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
                        int(body["user_id"]),
                    ),
                )
                self.send_json({"ok": True})
                return

            if path == "/api/messages/create":
                order = db_one("SELECT * FROM orders WHERE id=?", (int(body["order_id"]),))
                if not order:
                    self.send_error_json(404, "Order not found")
                    return
                sender_id = int(body["user_id"])
                receiver_id = order["selected_executor_id"] if sender_id == order["customer_id"] else order["customer_id"]
                if not receiver_id:
                    receiver_id = order["customer_id"]
                message_id = db_execute(
                    """
                    INSERT INTO chat_messages(order_id, sender_id, receiver_id, text, created_at)
                    VALUES(?,?,?,?,?)
                    """,
                    (int(body["order_id"]), sender_id, int(receiver_id), body.get("text") or "", now_iso()),
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
            if parsed.path == "/api/favorites/remove":
                user_id = int_param(query, "user_id")
                executor_id = int_param(query, "executor_id")
                db_execute("DELETE FROM favorites WHERE user_id=? AND target_id=?", (user_id, executor_id))
                self.send_json({"ok": True})
                return
            if parsed.path == "/api/portfolio/remove":
                portfolio_id = int_param(query, "portfolio_id")
                user_id = int_param(query, "user_id")
                db_execute(
                    "DELETE FROM portfolio_files WHERE id=? AND executor_id=?",
                    (portfolio_id, user_id),
                )
                self.send_json({"ok": True})
                return
            self.send_error_json(404, "Not found")
        except Exception as exc:
            logging.exception("API DELETE failed")
            self.send_error_json(500, str(exc))

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        origin = self.headers.get("Origin", "")
        allow_origin = API_CORS_ORIGIN or "*"
        if API_CORS_ORIGIN and origin == API_CORS_ORIGIN:
            allow_origin = origin
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", allow_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data")
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(raw)

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
