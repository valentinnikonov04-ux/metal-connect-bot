from datetime import datetime
from typing import Optional

from metal_connect_app.config import SUPPORT_ADMIN_ID, SUPPORT_ADMIN_USERNAME
from metal_connect_app.constants import ROLE_LABELS, STATUS_LABELS
from metal_connect_app.database import db_all, db_execute, db_one


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def display_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").strftime("%d.%m.%Y")
    except (TypeError, ValueError):
        return value or "Не указано"


def user_rating(user_id: int) -> tuple[float, int]:
    row = db_one(
        "SELECT AVG(stars) AS avg_stars, COUNT(*) AS cnt FROM reviews WHERE to_user_id=?",
        (user_id,),
    )
    if not row or not row["cnt"]:
        return 0.0, 0
    return round(float(row["avg_stars"]), 2), int(row["cnt"])


def get_user(user_id: int):
    return db_one("SELECT * FROM users WHERE id=?", (user_id,))


def get_support_admin_id() -> Optional[int]:
    if SUPPORT_ADMIN_ID:
        return SUPPORT_ADMIN_ID
    if not SUPPORT_ADMIN_USERNAME:
        return None
    admin = db_one(
        "SELECT id FROM users WHERE LOWER(username)=?",
        (SUPPORT_ADMIN_USERNAME,),
    )
    return int(admin["id"]) if admin else None


def is_support_admin(user_id: int) -> bool:
    if SUPPORT_ADMIN_ID and user_id == SUPPORT_ADMIN_ID:
        return True
    user = get_user(user_id)
    username = (user["username"] or "").lower() if user else ""
    return bool(SUPPORT_ADMIN_USERNAME and username == SUPPORT_ADMIN_USERNAME)


def first_name(user) -> str:
    if not user:
        return "друг"
    full_name = user["full_name"] or ""
    if full_name.strip():
        return full_name.strip().split()[0]
    return user["company"] or "друг"


def day_greeting() -> str:
    hour = datetime.now().hour
    if 5 <= hour < 12:
        return "Доброе утро"
    if 12 <= hour < 18:
        return "Добрый день"
    if 18 <= hour < 23:
        return "Добрый вечер"
    return "Доброй ночи"


def profile_progress(user) -> tuple[int, str]:
    if not user:
        return 0, "░░░░░░░░░░"
    fields = ["role", "company", "city", "phone", "email", "org_card_file_id", "specialization"]
    if user["role"] == "executor":
        fields.extend(["description", "work_status"])
    filled = sum(1 for field in fields if user[field])
    percent = int(filled / len(fields) * 100)
    bars = max(0, min(10, round(percent / 10)))
    return percent, "█" * bars + "░" * (10 - bars)


def executor_level(user_id: int) -> str:
    done_orders = db_one(
        "SELECT COUNT(*) AS cnt FROM orders WHERE selected_executor_id=? AND status='done'",
        (user_id,),
    )["cnt"]
    rating, reviews_count = user_rating(user_id)
    if done_orders >= 30 and rating >= 4.7 and reviews_count >= 10:
        return "Гуру"
    if done_orders >= 15 and rating >= 4.5:
        return "Профи"
    if done_orders >= 5:
        return "Мастер"
    return "Новичок"


def parse_price(value: str) -> Optional[float]:
    digits = "".join(ch if ch.isdigit() else " " for ch in value or "")
    numbers = [int(part) for part in digits.split() if part.isdigit()]
    return float(numbers[0]) if numbers else None


def offer_position(offer) -> str:
    offers = db_all("SELECT id, price FROM offers WHERE order_id=?", (offer["order_id"],))
    priced = [(row["id"], parse_price(row["price"])) for row in offers]
    priced = [(offer_id, price) for offer_id, price in priced if price is not None]
    if not priced or parse_price(offer["price"]) is None:
        return "Позицию по цене нельзя посчитать: цена указана текстом."
    priced.sort(key=lambda item: item[1])
    for index, item in enumerate(priced, 1):
        if item[0] == offer["id"]:
            return f"По цене это предложение на месте #{index} из {len(priced)} среди откликов с числовой ценой."
    return "Позиция предложения пока не рассчитана."


def ensure_user(message_or_callback):
    user = message_or_callback.from_user
    existing = get_user(user.id)
    if existing:
        db_execute(
            "UPDATE users SET username=?, full_name=?, updated_at=? WHERE id=?",
            (user.username, user.full_name, now_iso(), user.id),
        )
        return get_user(user.id)

    db_execute(
        """
        INSERT INTO users(id, username, full_name, created_at, updated_at)
        VALUES(?,?,?,?,?)
        """,
        (user.id, user.username, user.full_name, now_iso(), now_iso()),
    )
    return get_user(user.id)


def profile_text(user) -> str:
    if not user:
        return "Профиль пока не создан."

    rating, reviews_count = user_rating(user["id"])
    role = ROLE_LABELS.get(user["role"], "Роль не выбрана")
    company = user["company"] or "Не указано"
    city = user["city"] or "Не указано"
    phone = user["phone"] or "Не указано"
    email = user["email"] or "Не указано"
    specialization = user["specialization"] or "Не указано"
    description = user["description"] or "Не указано"
    work_status = user["work_status"] or "Не указано"
    rating_line = "нет оценок" if not reviews_count else f"{rating}/5, отзывов: {reviews_count}"
    progress_percent, progress_bar = profile_progress(user)

    lines = [
        "══════════",
        "Профиль участника",
        "══════════",
        "",
        f"Роль: {role}",
        f"Компания: {company}",
        f"Город: {city}",
        f"Телефон: {phone}",
        f"Почта: {email}",
    ]
    if user["role"] == "customer":
        lines.append(f"Чем занимается компания: {specialization}")
    else:
        lines.extend(
            [
                f"Специализация: {specialization}",
                f"Мощности/опыт: {description}",
                f"Статус: {work_status}",
                f"Уровень: {executor_level(user['id'])}",
            ]
        )
    lines.append(f"Рейтинг: {rating_line}")
    lines.append(f"Заполненность: {progress_bar} {progress_percent}%")
    return "\n".join(lines)


def order_text(order) -> str:
    status = STATUS_LABELS.get(order["status"], order["status"])
    return (
        f"Заказ #{order['id']}\n\n"
        f"Название: {order['title']}\n"
        f"Описание: {order['description']}\n"
        f"Бюджет: {order['budget']}\n"
        f"Город: {order['city']}\n"
        f"Срок: {order['deadline']}\n"
        f"Оплата: {order['payment_terms']}\n"
        f"Статус: {status}\n"
        f"Создан: {display_date(order['created_at'])}"
    )


def offer_text(offer) -> str:
    executor = get_user(offer["executor_id"])
    rating, count = user_rating(offer["executor_id"])
    rating_line = "нет оценок" if not count else f"{rating}/5"
    company = executor["company"] if executor and executor["company"] else "Компания не указана"
    city = executor["city"] if executor and executor["city"] else "Город не указан"
    return (
        f"Отклик #{offer['id']}\n\n"
        f"Исполнитель: {company}\n"
        f"Город: {city}\n"
        f"Рейтинг: {rating_line}\n"
        f"Уровень: {executor_level(offer['executor_id'])}\n"
        f"Цена: {offer['price']}\n"
        f"Срок: {offer['deadline']}\n"
        f"Комментарий: {offer['comment']}\n"
        f"{offer_position(offer)}"
    )


def company_label(user) -> str:
    if not user:
        return "Компания не указана"
    company = user["company"] or user["full_name"] or "Компания не указана"
    city = user["city"] or "город не указан"
    return f"{company}, {city}"
