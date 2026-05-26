import asyncio
import json
import logging
import sqlite3
from typing import Optional

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import (
    BotCommand,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)

from metal_connect_app.config import SUPPORT_ADMIN_USERNAME, TOKEN, WEBAPP_URL
from metal_connect_app.constants import ROLE_LABELS, STATUS_LABELS
from metal_connect_app.database import db_all, db_execute, db_one, init_db
from metal_connect_app.keyboards import (
    inline_menu,
    main_keyboard,
    order_keyboard,
    publish_more_keyboard,
    role_keyboard,
    status_keyboard,
    support_keyboard,
    work_status_keyboard,
)
from metal_connect_app.services import (
    company_label,
    day_greeting,
    display_date,
    ensure_user,
    executor_level,
    first_name,
    get_support_admin_id,
    get_user,
    is_support_admin,
    now_iso,
    offer_position,
    offer_text,
    order_text,
    profile_progress,
    profile_text,
    user_rating,
)
from metal_connect_app.texts import help_text

state = {}

logging.basicConfig(level=logging.INFO)
bot = Bot(TOKEN) if TOKEN else None
dp = Dispatcher()




async def send_menu(chat_id: int, user_id: int):
    user = get_user(user_id)
    role = user["role"] if user else None
    progress_percent, progress_bar = profile_progress(user)
    await bot.send_message(
        chat_id,
        f"{day_greeting()}, {first_name(user)}!\n\n"
        "METAL CONNECT\n"
        "Прямые заказы и проверенные исполнители в металлообработке.\n\n"
        f"Профиль: {progress_bar} {progress_percent}%",
        reply_markup=inline_menu(role, is_support_admin(user_id)),
    )


async def notify_executors(order_id: int):
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order:
        return

    executors = db_all(
        """
        SELECT id FROM users
        WHERE role='executor'
          AND id != ?
          AND company IS NOT NULL
        """,
        (order["customer_id"],),
    )
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Смотреть заказ", callback_data=f"order:view:{order_id}")],
            [InlineKeyboardButton(text="Откликнуться", callback_data=f"offer:new:{order_id}")],
        ]
    )

    for executor in executors:
        try:
            await bot.send_message(
                executor["id"],
                f"Новый заказ для расчета\n\n{order['title']}\nБюджет: {order['budget']}\nГород: {order['city']}",
                reply_markup=keyboard,
            )
        except Exception as exc:
            logging.warning("Cannot notify executor %s: %s", executor["id"], exc)


async def send_order(message: Message, order_id: int):
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order:
        await message.answer("Заказ не найден.")
        return

    user = get_user(message.chat.id)
    role = user["role"] if user else None
    keyboard_role = "customer" if message.chat.id == order["customer_id"] else role
    files = db_all("SELECT * FROM order_files WHERE order_id=? ORDER BY id", (order_id,))

    await message.answer(
        order_text(order),
        reply_markup=order_keyboard(order_id, keyboard_role, order["customer_id"] if keyboard_role == "customer" else None),
    )

    for file in files:
        caption = file["caption"] or "Вложение к заказу"
        if file["file_type"] == "photo":
            await message.answer_photo(file["file_id"], caption=caption)
        else:
            await message.answer_document(file["file_id"], caption=caption)


async def send_profile_files(message: Message, user):
    if not user:
        return
    if user["org_card_file_id"]:
        if user["org_card_file_type"] == "photo":
            await message.answer_photo(user["org_card_file_id"], caption="Карточка организации")
        else:
            await message.answer_document(user["org_card_file_id"], caption="Карточка организации")

    if user["role"] != "executor":
        return

    equipment_files = db_all(
        "SELECT * FROM executor_equipment_files WHERE executor_id=? ORDER BY id",
        (user["id"],),
    )
    portfolio_files = db_all(
        "SELECT * FROM portfolio_files WHERE executor_id=? ORDER BY id",
        (user["id"],),
    )
    for file in equipment_files:
        caption = file["caption"] or "Оборудование производства"
        if file["file_type"] == "photo":
            await message.answer_photo(file["file_id"], caption=caption)
        else:
            await message.answer_document(file["file_id"], caption=caption)
    for file in portfolio_files:
        caption = file["caption"] or "Портфолио выполненных работ"
        if file["file_type"] == "photo":
            await message.answer_photo(file["file_id"], caption=caption)
        else:
            await message.answer_document(file["file_id"], caption=caption)


async def finish_profile(message: Message, uid: int, data: dict):
    db_execute(
        """
        UPDATE users
        SET role=?, company=?, city=?, phone=?, email=?, org_card_file_id=?,
            org_card_file_type=?, specialization=?, description=?, work_status=?, updated_at=?
        WHERE id=?
        """,
        (
            data["role"],
            data["company"],
            data["city"],
            data["phone"],
            data["email"],
            data.get("org_card_file_id"),
            data.get("org_card_file_type"),
            data.get("specialization", ""),
            data.get("description", ""),
            data.get("work_status", "Принимаю заказы"),
            now_iso(),
            uid,
        ),
    )
    db_execute("DELETE FROM executor_equipment_files WHERE executor_id=?", (uid,))
    db_execute("DELETE FROM portfolio_files WHERE executor_id=?", (uid,))
    for file in data.get("equipment_files", []):
        db_execute(
            """
            INSERT INTO executor_equipment_files(executor_id, file_id, file_type, caption, created_at)
            VALUES(?,?,?,?,?)
            """,
            (uid, file["file_id"], file["file_type"], file.get("caption", ""), now_iso()),
        )
    for file in data.get("portfolio_files", []):
        db_execute(
            """
            INSERT INTO portfolio_files(executor_id, file_id, file_type, caption, created_at)
            VALUES(?,?,?,?,?)
            """,
            (uid, file["file_id"], file["file_type"], file.get("caption", ""), now_iso()),
        )
    state.pop(uid, None)
    await message.answer("Профиль сохранен.", reply_markup=main_keyboard(data.get("role")))
    await send_menu(message.chat.id, uid)


async def finish_order(message: Message, uid: int, data: dict):
    order_id = db_execute(
        """
        INSERT INTO orders(customer_id, title, description, budget, city, deadline,
                           payment_terms, status, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        """,
        (
            uid,
            data["title"],
            data["description"],
            data["budget"],
            data["city"],
            data["deadline"],
            data["payment_terms"],
            "new",
            now_iso(),
            now_iso(),
        ),
    )

    for file in data.get("files", []):
        db_execute(
            """
            INSERT INTO order_files(order_id, file_id, file_type, caption, created_at)
            VALUES(?,?,?,?,?)
            """,
            (order_id, file["file_id"], file["file_type"], file.get("caption", ""), now_iso()),
        )

    state.pop(uid, None)
    await message.answer(
        f"Заказ #{order_id} опубликован.\n\n"
        "Отличное описание повышает шанс быстрого отклика. Исполнители уже получат уведомление.",
        reply_markup=publish_more_keyboard(),
    )
    orders_count = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=?", (uid,))["cnt"]
    if orders_count == 1:
        await message.answer("Поздравляю с первым заказом в METAL CONNECT.")
    elif orders_count and orders_count % 5 == 0:
        await message.answer("Вы классный заказчик. Спасибо, что размещаете заказы напрямую.")
    await notify_executors(order_id)


async def publish_webapp_order(message: Message, payload: dict):
    title = (payload.get("title") or "").strip()
    description = (payload.get("description") or "").strip()
    budget = (payload.get("budget") or "").strip()
    city = (payload.get("city") or "").strip()
    deadline = (payload.get("deadline") or "").strip()
    payment_terms = (payload.get("payment_terms") or "").strip()

    if not all([title, description, budget, city, deadline, payment_terms]):
        await message.answer("Mini App передала неполные данные заказа. Проверьте поля и попробуйте снова.")
        return

    await finish_order(
        message,
        message.from_user.id,
        {
            "title": title,
            "description": description,
            "budget": budget,
            "city": city,
            "deadline": deadline,
            "payment_terms": payment_terms,
            "files": [],
        },
    )


async def finish_offer(message: Message, uid: int, data: dict):
    order = db_one("SELECT * FROM orders WHERE id=?", (data["order_id"],))
    if not order:
        state.pop(uid, None)
        await message.answer("Заказ не найден.")
        return

    try:
        offer_id = db_execute(
            """
            INSERT INTO offers(order_id, executor_id, price, deadline, comment, created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (data["order_id"], uid, data["price"], data["deadline"], data["comment"], now_iso()),
        )
    except sqlite3.IntegrityError:
        db_execute(
            """
            UPDATE offers SET price=?, deadline=?, comment=?, created_at=?
            WHERE order_id=? AND executor_id=?
            """,
            (data["price"], data["deadline"], data["comment"], now_iso(), data["order_id"], uid),
        )
        offer = db_one(
            "SELECT id FROM offers WHERE order_id=? AND executor_id=?",
            (data["order_id"], uid),
        )
        offer_id = offer["id"]

    state.pop(uid, None)
    await message.answer("Отклик отправлен заказчику. Если у заказчика появится вопрос, он напишет прямо сюда.")

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Смотреть отклики", callback_data=f"offers:order:{data['order_id']}")],
            [InlineKeyboardButton(text="Написать исполнителю", callback_data=f"chat:with:{data['order_id']}:{uid}")],
        ]
    )
    await bot.send_message(
        order["customer_id"],
        f"Ура! Есть новый отклик на заказ #{data['order_id']}.\n\n"
        f"Отклик #{offer_id}. Откройте список предложений, чтобы сравнить цену, срок и профиль исполнителя.",
        reply_markup=keyboard,
    )


async def send_myday(message: Message):
    user = get_user(message.from_user.id)
    if not user:
        await message.answer("Сначала нажмите /start.")
        return
    if user["role"] == "customer":
        orders_count = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=?", (user["id"],))["cnt"]
        active_count = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=? AND status IN ('new','work')", (user["id"],))["cnt"]
        done_count = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE customer_id=? AND status='done'", (user["id"],))["cnt"]
        offers_count = db_one(
            """
            SELECT COUNT(*) AS cnt FROM offers
            JOIN orders ON orders.id=offers.order_id
            WHERE orders.customer_id=?
            """,
            (user["id"],),
        )["cnt"]
        await message.answer(
            f"Сводка дня для {first_name(user)}\n\n"
            f"Всего заказов: {orders_count}\n"
            f"Актуальных: {active_count}\n"
            f"Завершенных: {done_count}\n"
            f"Получено предложений: {offers_count}\n\n"
            "Если по заказу мало откликов, добавьте фото или чертежи - это заметно повышает доверие исполнителей."
        )
        return

    offers_count = db_one("SELECT COUNT(*) AS cnt FROM offers WHERE executor_id=?", (user["id"],))["cnt"]
    accepted_count = db_one("SELECT COUNT(*) AS cnt FROM offers WHERE executor_id=? AND status='accepted'", (user["id"],))["cnt"]
    favorite_count = db_one("SELECT COUNT(*) AS cnt FROM favorite_orders WHERE user_id=?", (user["id"],))["cnt"]
    rating, reviews_count = user_rating(user["id"])
    await message.answer(
        f"Сводка дня для {first_name(user)}\n\n"
        f"Ваш уровень: {executor_level(user['id'])}\n"
        f"Откликов отправлено: {offers_count}\n"
        f"Принято откликов: {accepted_count}\n"
        f"Избранных заказов: {favorite_count}\n"
        f"Рейтинг: {'нет оценок' if not reviews_count else f'{rating}/5'}"
    )


async def send_top(message: Message):
    rows = db_all(
        """
        SELECT u.id, u.company, u.city, AVG(r.stars) AS rating, COUNT(r.id) AS cnt
        FROM users u
        JOIN reviews r ON r.to_user_id=u.id
        WHERE u.role='executor' AND u.company IS NOT NULL
        GROUP BY u.id
        ORDER BY rating DESC, cnt DESC
        LIMIT 10
        """
    )
    if not rows:
        await message.answer("ТОП исполнителей появится после первых оценок.")
        return
    lines = ["Топ исполнителей"]
    for index, row in enumerate(rows, 1):
        badge = "Топ-10 месяца" if index <= 10 else ""
        lines.append(f"{index}. {row['company']}, {row['city']} - {round(row['rating'], 2)}/5 ({row['cnt']}) {badge}")
    await message.answer("\n".join(lines))


async def start_order_flow(message: Message):
    user = get_user(message.from_user.id)
    if user and user["role"] == "executor":
        await message.answer(
            "Создавать заказы могут заказчики. Если вы хотите искать работу, нажмите «Новые/актуальные заказы»."
        )
        return
    state[message.from_user.id] = {"flow": "order", "step": "title", "files": []}
    await message.answer("Название заказа. Например: Фрезеровка плит 09Г2С, 30 шт.")


async def start_support_flow(message: Message, user_id: Optional[int] = None):
    uid = user_id or message.from_user.id
    state[uid] = {"flow": "support", "step": "message"}
    await message.answer("Опишите проблему, вопрос или идею. Я передам сообщение администратору.")


async def show_my_offers(message: Message, user_id: int):
    rows = db_all(
        """
        SELECT o.id AS offer_id, o.price, o.deadline, o.status AS offer_status,
               orders.id AS order_id, orders.title, orders.status AS order_status
        FROM offers o
        JOIN orders ON orders.id=o.order_id
        WHERE o.executor_id=?
        ORDER BY o.id DESC
        LIMIT 20
        """,
        (user_id,),
    )
    if not rows:
        await message.answer("У вас пока нет откликов. Откройте актуальные заказы и отправьте первое предложение.")
        return

    for row in rows:
        await message.answer(
            f"Отклик #{row['offer_id']} на заказ #{row['order_id']}\n"
            f"{row['title']}\n"
            f"Цена: {row['price']}\n"
            f"Срок: {row['deadline']}\n"
            f"Статус заказа: {STATUS_LABELS.get(row['order_status'], row['order_status'])}",
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[[InlineKeyboardButton(text="Открыть заказ", callback_data=f"order:view:{row['order_id']}")]]
            ),
        )


@dp.message(Command("start"))
async def start(message: Message):
    user = ensure_user(message)
    user = get_user(message.from_user.id) or user
    await message.answer(
        f"{day_greeting()}, {first_name(user)}!\n\n"
        "Добро пожаловать в METAL CONNECT.\n"
        "Здесь заказчики размещают реальные задачи по металлообработке, а исполнители предлагают цену, срок и свои мощности напрямую.",
        reply_markup=main_keyboard(user["role"] if user else None),
    )
    await message.answer("Кем вы будете пользоваться ботом?", reply_markup=role_keyboard())


@dp.message(Command("menu"))
async def command_menu(message: Message):
    ensure_user(message)
    await send_menu(message.chat.id, message.from_user.id)


@dp.message(Command("profile"))
async def command_profile(message: Message):
    ensure_user(message)
    user = get_user(message.from_user.id)
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Редактировать профиль", callback_data="profile:edit")]]
    )
    await message.answer(profile_text(user), reply_markup=keyboard)
    await send_profile_files(message, user)


@dp.message(Command("orders"))
async def command_orders(message: Message):
    ensure_user(message)
    user = get_user(message.from_user.id)
    if user and user["role"] == "customer":
        await show_my_orders(message)
    else:
        await show_open_orders(message)


@dp.message(Command("myday"))
async def command_myday(message: Message):
    ensure_user(message)
    await send_myday(message)


@dp.message(Command("top"))
async def command_top(message: Message):
    ensure_user(message)
    await send_top(message)


@dp.message(Command("app"))
async def command_app(message: Message):
    ensure_user(message)
    if not WEBAPP_URL:
        await message.answer(
            "Mini App уже подготовлена в папке metal_connect_app/webapp.\n\n"
            "Чтобы открыть ее прямо в Telegram, нужен публичный HTTPS-адрес.\n\n"
            "Быстрый локальный вариант:\n"
            "1. Запустите Mini App: python3 -m http.server 8088 --directory metal_connect_app/webapp\n"
            "2. Сделайте HTTPS-туннель через ngrok/cloudflared.\n"
            "3. Скопируйте полученный https:// URL в .env как METAL_CONNECT_WEBAPP_URL.\n"
            "4. Перезапустите бота."
        )
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Открыть Mini App v4", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer(
        "Открывайте визуальный кабинет METAL CONNECT.\n\n"
        f"Текущая ссылка: {WEBAPP_URL}",
        reply_markup=keyboard,
    )


@dp.message(Command("help"))
async def command_help(message: Message):
    await message.answer(help_text(), reply_markup=support_keyboard())


@dp.callback_query(F.data == "menu")
async def menu_callback(callback: CallbackQuery):
    ensure_user(callback)
    await send_menu(callback.message.chat.id, callback.from_user.id)
    await callback.answer()


@dp.callback_query(F.data == "help:view")
async def help_callback(callback: CallbackQuery):
    ensure_user(callback)
    await callback.message.answer(help_text(), reply_markup=support_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("role:"))
async def choose_role(callback: CallbackQuery):
    ensure_user(callback)
    role = callback.data.split(":")[1]
    state[callback.from_user.id] = {"flow": "profile", "step": "company", "role": role}
    await callback.message.answer(
        f"Роль: {ROLE_LABELS[role]}.\n\nВведите название компании или ИП."
    )
    await callback.answer()


@dp.callback_query(F.data == "profile:view")
async def view_profile(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Редактировать профиль", callback_data="profile:edit")],
            [InlineKeyboardButton(text="В меню", callback_data="menu")],
        ]
    )
    await callback.message.answer(profile_text(user), reply_markup=keyboard)
    await send_profile_files(callback.message, user)
    await callback.answer()


@dp.callback_query(F.data == "profile:edit")
async def edit_profile(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    role = user["role"] if user and user["role"] else "customer"
    state[callback.from_user.id] = {"flow": "profile", "step": "company", "role": role}
    await callback.message.answer("Введите название компании или ИП.")
    await callback.answer()


@dp.callback_query(F.data == "order:new")
async def new_order(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    if not user or not user["role"]:
        await callback.message.answer("Сначала выберите роль и заполните профиль.", reply_markup=role_keyboard())
        await callback.answer()
        return

    state[callback.from_user.id] = {"flow": "order", "step": "title", "files": []}
    await callback.message.answer("Название заказа. Например: Токарная обработка втулок 40Х, 120 шт.")
    await callback.answer()


async def show_open_orders(message: Message, city: Optional[str] = None, budget: Optional[str] = None):
    params = []
    filters = ["status IN ('new', 'work')"]
    if city:
        filters.append("LOWER(city) LIKE ?")
        params.append(f"%{city.lower()}%")
    if budget:
        filters.append("LOWER(budget) LIKE ?")
        params.append(f"%{budget.lower()}%")

    rows = db_all(
        f"""
        SELECT * FROM orders
        WHERE {' AND '.join(filters)}
        ORDER BY id DESC
        LIMIT 20
        """,
        params,
    )
    if not rows:
        await message.answer("Подходящих заказов пока нет.")
        return

    for order in rows:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Открыть", callback_data=f"order:view:{order['id']}")],
                [InlineKeyboardButton(text="Откликнуться", callback_data=f"offer:new:{order['id']}")],
                [InlineKeyboardButton(text="Добавить заказ в избранное", callback_data=f"favorite_order:add:{order['id']}")],
            ]
        )
        await message.answer(
            f"#{order['id']} {order['title']}\n"
            f"Бюджет: {order['budget']}\n"
            f"Город: {order['city']}\n"
            f"Срок: {order['deadline']}\n"
            f"Создан: {display_date(order['created_at'])}",
            reply_markup=keyboard,
        )


async def show_my_orders(message: Message):
    rows = db_all(
        "SELECT * FROM orders WHERE customer_id=? AND status IN ('new','work') ORDER BY id DESC LIMIT 20",
        (message.chat.id,),
    )
    if not rows:
        await message.answer("Актуальных заказов пока нет. Можно разместить новый или открыть архив завершенных.")
        return

    for order in rows:
        await message.answer(
            f"#{order['id']} {order['title']}\n"
            f"Статус: {STATUS_LABELS.get(order['status'], order['status'])}\n"
            f"Бюджет: {order['budget']}\n"
            f"Создан: {display_date(order['created_at'])}",
            reply_markup=order_keyboard(order["id"], "customer", order["customer_id"]),
        )


async def show_archived_orders(message: Message):
    rows = db_all(
        "SELECT * FROM orders WHERE customer_id=? AND status IN ('done','cancelled') ORDER BY id DESC LIMIT 30",
        (message.chat.id,),
    )
    if not rows:
        await message.answer("Завершенных или отмененных заказов пока нет.")
        return

    for order in rows:
        await message.answer(
            f"#{order['id']} {order['title']}\n"
            f"Статус: {STATUS_LABELS.get(order['status'], order['status'])}\n"
            f"Бюджет: {order['budget']}\n"
            f"Создан: {display_date(order['created_at'])}",
            reply_markup=order_keyboard(order["id"], "customer", order["customer_id"]),
        )


@dp.callback_query(F.data == "orders:open")
async def open_orders(callback: CallbackQuery):
    ensure_user(callback)
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Поиск по фильтрам", callback_data="search:start")],
            [InlineKeyboardButton(text="В меню", callback_data="menu")],
        ]
    )
    await callback.message.answer("Последние активные заказы:", reply_markup=keyboard)
    await show_open_orders(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "orders:mine")
async def my_orders(callback: CallbackQuery):
    ensure_user(callback)
    await show_my_orders(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "orders:archive")
async def archived_orders(callback: CallbackQuery):
    ensure_user(callback)
    await show_archived_orders(callback.message)
    await callback.answer()


@dp.callback_query(F.data == "search:start")
async def search_start(callback: CallbackQuery):
    state[callback.from_user.id] = {"flow": "search", "step": "city"}
    await callback.message.answer("Введите город для поиска или '-' чтобы пропустить.")
    await callback.answer()


@dp.callback_query(F.data.startswith("order:view:"))
async def view_order(callback: CallbackQuery):
    ensure_user(callback)
    order_id = int(callback.data.split(":")[2])
    await send_order(callback.message, order_id)
    await callback.answer()


@dp.callback_query(F.data.startswith("offer:new:"))
async def new_offer(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    if not user or user["role"] != "executor":
        await callback.message.answer("Откликаться могут исполнители. Выберите роль исполнителя в профиле.")
        await callback.answer()
        return

    order_id = int(callback.data.split(":")[2])
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order:
        await callback.message.answer("Заказ не найден.")
        await callback.answer()
        return
    if order["customer_id"] == callback.from_user.id:
        await callback.message.answer("На свой заказ откликнуться нельзя.")
        await callback.answer()
        return

    state[callback.from_user.id] = {"flow": "offer", "step": "price", "order_id": order_id}
    await callback.message.answer("Укажите цену или вилку цены.")
    await callback.answer()


@dp.callback_query(F.data.startswith("offers:order:"))
async def order_offers(callback: CallbackQuery):
    ensure_user(callback)
    order_id = int(callback.data.split(":")[2])
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order or order["customer_id"] != callback.from_user.id:
        await callback.message.answer("Отклики доступны только владельцу заказа.")
        await callback.answer()
        return

    offers = db_all("SELECT * FROM offers WHERE order_id=? ORDER BY id DESC", (order_id,))
    if not offers:
        await callback.message.answer("Откликов пока нет.")
        await callback.answer()
        return

    summary_lines = [f"Все предложения по заказу #{order_id}", ""]
    for index, offer in enumerate(offers, 1):
        executor = get_user(offer["executor_id"])
        summary_lines.append(
            f"{index}. {company_label(executor)} | цена: {offer['price']} | срок: {offer['deadline']}"
        )
    await callback.message.answer("\n".join(summary_lines))

    for offer in offers:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Выбрать исполнителя", callback_data=f"offer:accept:{offer['id']}")],
                [InlineKeyboardButton(text="Написать", callback_data=f"chat:with:{order_id}:{offer['executor_id']}")],
                [InlineKeyboardButton(text="Посмотреть профиль исполнителя", callback_data=f"user:view:{offer['executor_id']}")],
                [InlineKeyboardButton(text="Позиция предложения", callback_data=f"offer:position:{offer['id']}")],
            ]
        )
        await callback.message.answer(offer_text(offer), reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("offer:position:"))
async def offer_position_callback(callback: CallbackQuery):
    ensure_user(callback)
    offer_id = int(callback.data.split(":")[2])
    offer = db_one("SELECT * FROM offers WHERE id=?", (offer_id,))
    if not offer:
        await callback.message.answer("Отклик не найден.")
        await callback.answer()
        return
    order = db_one("SELECT * FROM orders WHERE id=?", (offer["order_id"],))
    if not order or order["customer_id"] != callback.from_user.id:
        await callback.message.answer("Позицию предложения может смотреть только владелец заказа.")
        await callback.answer()
        return
    await callback.message.answer(offer_position(offer))
    await callback.answer()


@dp.callback_query(F.data == "offers:mine")
async def my_offers(callback: CallbackQuery):
    ensure_user(callback)
    await show_my_offers(callback.message, callback.from_user.id)
    await callback.answer()


@dp.callback_query(F.data.startswith("offer:accept:"))
async def accept_offer(callback: CallbackQuery):
    ensure_user(callback)
    offer_id = int(callback.data.split(":")[2])
    offer = db_one("SELECT * FROM offers WHERE id=?", (offer_id,))
    if not offer:
        await callback.message.answer("Отклик не найден.")
        await callback.answer()
        return

    order = db_one("SELECT * FROM orders WHERE id=?", (offer["order_id"],))
    if not order or order["customer_id"] != callback.from_user.id:
        await callback.message.answer("Выбрать исполнителя может только владелец заказа.")
        await callback.answer()
        return

    db_execute(
        "UPDATE orders SET selected_executor_id=?, status='work', updated_at=? WHERE id=?",
        (offer["executor_id"], now_iso(), offer["order_id"]),
    )
    db_execute("UPDATE offers SET status='accepted' WHERE id=?", (offer_id,))
    db_execute(
        "UPDATE offers SET status='rejected' WHERE order_id=? AND id != ?",
        (offer["order_id"], offer_id),
    )

    await callback.message.answer("Исполнитель выбран. Заказ переведен в статус В работе.")
    await bot.send_message(
        offer["executor_id"],
        f"Ваш отклик по заказу #{offer['order_id']} принят. Заказчик может написать вам в чате бота.",
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("status:menu:"))
async def status_menu(callback: CallbackQuery):
    order_id = int(callback.data.split(":")[2])
    await callback.message.answer("Выберите новый статус заказа.", reply_markup=status_keyboard(order_id))
    await callback.answer()


@dp.callback_query(F.data.startswith("status:set:"))
async def set_status(callback: CallbackQuery):
    parts = callback.data.split(":")
    order_id = int(parts[2])
    status = parts[3]
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order or order["customer_id"] != callback.from_user.id:
        await callback.message.answer("Статус может менять только владелец заказа.")
        await callback.answer()
        return

    db_execute("UPDATE orders SET status=?, updated_at=? WHERE id=?", (status, now_iso(), order_id))
    await callback.message.answer(f"Статус заказа #{order_id}: {STATUS_LABELS[status]}.")

    if status == "done" and order["selected_executor_id"]:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Поставить оценку", callback_data=f"review:start:{order_id}:{order['selected_executor_id']}")]
            ]
        )
        await callback.message.answer("Заказ завершен. Оцените исполнителя.", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("review:start:"))
async def review_start(callback: CallbackQuery):
    parts = callback.data.split(":")
    order_id = int(parts[2])
    target_id = int(parts[3])
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="1", callback_data=f"review:stars:{order_id}:{target_id}:1"),
                InlineKeyboardButton(text="2", callback_data=f"review:stars:{order_id}:{target_id}:2"),
                InlineKeyboardButton(text="3", callback_data=f"review:stars:{order_id}:{target_id}:3"),
                InlineKeyboardButton(text="4", callback_data=f"review:stars:{order_id}:{target_id}:4"),
                InlineKeyboardButton(text="5", callback_data=f"review:stars:{order_id}:{target_id}:5"),
            ]
        ]
    )
    await callback.message.answer("Оценка от 1 до 5:", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("review:stars:"))
async def review_stars(callback: CallbackQuery):
    parts = callback.data.split(":")
    state[callback.from_user.id] = {
        "flow": "review",
        "step": "text",
        "order_id": int(parts[2]),
        "target_id": int(parts[3]),
        "stars": int(parts[4]),
    }
    await callback.message.answer("Напишите короткий отзыв или '-' чтобы оставить только оценку.")
    await callback.answer()


@dp.callback_query(F.data.startswith("chat:start:"))
async def chat_start(callback: CallbackQuery):
    order_id = int(callback.data.split(":")[2])
    order = db_one("SELECT * FROM orders WHERE id=?", (order_id,))
    if not order:
        await callback.message.answer("Заказ не найден.")
        await callback.answer()
        return

    if callback.from_user.id == order["customer_id"]:
        if not order["selected_executor_id"]:
            await callback.message.answer("Сначала выберите исполнителя из откликов.")
            await callback.answer()
            return
        receiver_id = order["selected_executor_id"]
    else:
        receiver_id = order["customer_id"]

    state[callback.from_user.id] = {
        "flow": "chat",
        "step": "message",
        "order_id": order_id,
        "receiver_id": receiver_id,
    }
    await callback.message.answer("Напишите сообщение. Оно уйдет второй стороне через бота.")
    await callback.answer()


@dp.callback_query(F.data.startswith("chat:with:"))
async def chat_with(callback: CallbackQuery):
    parts = callback.data.split(":")
    order_id = int(parts[2])
    receiver_id = int(parts[3])
    state[callback.from_user.id] = {
        "flow": "chat",
        "step": "message",
        "order_id": order_id,
        "receiver_id": receiver_id,
    }
    await callback.message.answer("Напишите сообщение. Оно уйдет второй стороне через бота.")
    await callback.answer()


@dp.callback_query(F.data.startswith("user:view:"))
async def user_view(callback: CallbackQuery):
    ensure_user(callback)
    user_id = int(callback.data.split(":")[2])
    user = get_user(user_id)
    if not user:
        await callback.message.answer("Профиль не найден.")
        await callback.answer()
        return

    viewer = get_user(callback.from_user.id)
    rows = []
    if viewer and viewer["role"] == "customer" and user["role"] == "executor":
        rows.append([InlineKeyboardButton(text="Добавить исполнителя в избранное", callback_data=f"favorite:add:{user_id}")])
    elif viewer and viewer["role"] == "executor" and user["role"] == "customer":
        rows.append([InlineKeyboardButton(text="Добавить заказчика в избранное", callback_data=f"favorite:add:{user_id}")])
    rows.append([InlineKeyboardButton(text="В меню", callback_data="menu")])
    await callback.message.answer(profile_text(user), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await send_profile_files(callback.message, user)
    await callback.answer()


@dp.callback_query(F.data.startswith("favorite:add:"))
async def favorite_add(callback: CallbackQuery):
    target_id = int(callback.data.split(":")[2])
    actor = get_user(callback.from_user.id)
    target = get_user(target_id)
    if not actor or not target:
        await callback.message.answer("Профиль не найден.")
        await callback.answer()
        return
    allowed = (
        actor["role"] == "customer" and target["role"] == "executor"
    ) or (
        actor["role"] == "executor" and target["role"] == "customer"
    )
    if not allowed:
        await callback.message.answer("В избранное можно добавлять только подходящих участников: заказчик - исполнителя, исполнитель - заказчика.")
        await callback.answer()
        return
    try:
        db_execute(
            "INSERT INTO favorites(user_id, target_id, created_at) VALUES(?,?,?)",
            (callback.from_user.id, target_id, now_iso()),
        )
        await callback.message.answer("Добавлено в избранное.")
    except sqlite3.IntegrityError:
        await callback.message.answer("Уже есть в избранном.")
    await callback.answer()


@dp.callback_query(F.data == "favorites:list")
async def favorites_list(callback: CallbackQuery):
    ensure_user(callback)
    actor = get_user(callback.from_user.id)
    if actor and actor["role"] == "customer":
        expected_role = "executor"
        empty_text = "У вас пока нет исполнителей в избранном."
    elif actor and actor["role"] == "executor":
        expected_role = "customer"
        empty_text = "У вас пока нет заказчиков в избранном."
    else:
        expected_role = None
        empty_text = "Избранное пока пустое."
    role_filter = "AND u.role=?" if expected_role else ""
    params = [callback.from_user.id]
    if expected_role:
        params.append(expected_role)
    rows = db_all(
        f"""
        SELECT u.* FROM favorites f
        JOIN users u ON u.id=f.target_id
        WHERE f.user_id=? {role_filter}
        ORDER BY f.created_at DESC
        """,
        params,
    )
    if not rows:
        await callback.message.answer(empty_text)
        await callback.answer()
        return

    for user in rows:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Открыть профиль", callback_data=f"user:view:{user['id']}")],
                [InlineKeyboardButton(text="Удалить", callback_data=f"favorite:del:{user['id']}")],
            ]
        )
        await callback.message.answer(profile_text(user), reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("favorite:del:"))
async def favorite_delete(callback: CallbackQuery):
    target_id = int(callback.data.split(":")[2])
    db_execute("DELETE FROM favorites WHERE user_id=? AND target_id=?", (callback.from_user.id, target_id))
    await callback.message.answer("Удалено из избранного.")
    await callback.answer()


@dp.callback_query(F.data.startswith("favorite_order:add:"))
async def favorite_order_add(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    if not user or user["role"] != "executor":
        await callback.message.answer("Избранные заказы доступны исполнителям.")
        await callback.answer()
        return
    order_id = int(callback.data.split(":")[2])
    order = db_one("SELECT id FROM orders WHERE id=?", (order_id,))
    if not order:
        await callback.message.answer("Заказ не найден.")
        await callback.answer()
        return
    try:
        db_execute(
            "INSERT INTO favorite_orders(user_id, order_id, created_at) VALUES(?,?,?)",
            (callback.from_user.id, order_id, now_iso()),
        )
        await callback.message.answer("Заказ добавлен в избранное.")
    except sqlite3.IntegrityError:
        await callback.message.answer("Этот заказ уже есть в избранном.")
    await callback.answer()


@dp.callback_query(F.data == "favorite_orders:list")
async def favorite_orders_list(callback: CallbackQuery):
    ensure_user(callback)
    rows = db_all(
        """
        SELECT o.* FROM favorite_orders f
        JOIN orders o ON o.id=f.order_id
        WHERE f.user_id=?
        ORDER BY f.created_at DESC
        """,
        (callback.from_user.id,),
    )
    if not rows:
        await callback.message.answer("У вас пока нет избранных заказов.")
        await callback.answer()
        return
    for order in rows:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Открыть", callback_data=f"order:view:{order['id']}")],
                [InlineKeyboardButton(text="Удалить из избранного", callback_data=f"favorite_order:del:{order['id']}")],
            ]
        )
        await callback.message.answer(
            f"#{order['id']} {order['title']}\n"
            f"Статус: {STATUS_LABELS.get(order['status'], order['status'])}\n"
            f"Бюджет: {order['budget']}\n"
            f"Город: {order['city']}",
            reply_markup=keyboard,
        )
    await callback.answer()


@dp.callback_query(F.data.startswith("favorite_order:del:"))
async def favorite_order_delete(callback: CallbackQuery):
    order_id = int(callback.data.split(":")[2])
    db_execute("DELETE FROM favorite_orders WHERE user_id=? AND order_id=?", (callback.from_user.id, order_id))
    await callback.message.answer("Заказ удален из избранного.")
    await callback.answer()


@dp.callback_query(F.data.startswith("users:"))
async def users_list(callback: CallbackQuery):
    role = "executor" if callback.data.endswith("executors") else "customer"
    rows = db_all(
        """
        SELECT * FROM users
        WHERE role=? AND company IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 20
        """,
        (role,),
    )
    if not rows:
        await callback.message.answer("Пока нет заполненных профилей.")
        await callback.answer()
        return

    for user in rows:
        button_text = "Добавить исполнителя в избранное" if role == "executor" else "Добавить заказчика в избранное"
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Открыть профиль", callback_data=f"user:view:{user['id']}")],
                [InlineKeyboardButton(text=button_text, callback_data=f"favorite:add:{user['id']}")],
            ]
        )
        await callback.message.answer(profile_text(user), reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "top:list")
async def top_list(callback: CallbackQuery):
    rows = db_all(
        """
        SELECT u.id, u.company, u.city, u.role, AVG(r.stars) AS rating, COUNT(r.id) AS cnt
        FROM users u
        JOIN reviews r ON r.to_user_id=u.id
        WHERE u.company IS NOT NULL
        GROUP BY u.id
        ORDER BY rating DESC, cnt DESC
        LIMIT 10
        """
    )
    if not rows:
        await callback.message.answer("ТОП появится после первых оценок.")
        await callback.answer()
        return

    lines = ["ТОП участников"]
    for index, row in enumerate(rows, 1):
        lines.append(
            f"{index}. {row['company']} ({ROLE_LABELS.get(row['role'], row['role'])}, {row['city']}) - "
            f"{round(row['rating'], 2)}/5, отзывов: {row['cnt']}"
        )
    await callback.message.answer("\n".join(lines))
    await callback.answer()


@dp.callback_query(F.data == "stats:view")
async def stats_view(callback: CallbackQuery):
    ensure_user(callback)
    if not is_support_admin(callback.from_user.id):
        await callback.message.answer("Статистика доступна только администратору.")
        await callback.answer()
        return
    users_count = db_one("SELECT COUNT(*) AS cnt FROM users WHERE role IS NOT NULL")["cnt"]
    executors_count = db_one("SELECT COUNT(*) AS cnt FROM users WHERE role='executor'")["cnt"]
    customers_count = db_one("SELECT COUNT(*) AS cnt FROM users WHERE role='customer'")["cnt"]
    orders_count = db_one("SELECT COUNT(*) AS cnt FROM orders")["cnt"]
    active_orders = db_one("SELECT COUNT(*) AS cnt FROM orders WHERE status IN ('new','work')")["cnt"]
    offers_count = db_one("SELECT COUNT(*) AS cnt FROM offers")["cnt"]
    await callback.message.answer(
        "Статистика\n\n"
        f"Участников: {users_count}\n"
        f"Заказчиков: {customers_count}\n"
        f"Исполнителей: {executors_count}\n"
        f"Заказов всего: {orders_count}\n"
        f"Активных заказов: {active_orders}\n"
        f"Откликов: {offers_count}"
    )
    await callback.answer()


@dp.callback_query(F.data == "work_status:menu")
async def work_status_menu(callback: CallbackQuery):
    ensure_user(callback)
    user = get_user(callback.from_user.id)
    if not user or user["role"] != "executor":
        await callback.message.answer("Статус работы доступен исполнителям.")
        await callback.answer()
        return
    await callback.message.answer("Выберите статус работы.", reply_markup=work_status_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("work_status:set:"))
async def work_status_set(callback: CallbackQuery):
    ensure_user(callback)
    status = callback.data.split(":", 2)[2]
    current = state.get(callback.from_user.id)
    if current and current.get("flow") == "profile" and current.get("step") == "work_status":
        current["work_status"] = status
        await finish_profile(callback.message, callback.from_user.id, current)
        await callback.answer()
        return
    db_execute("UPDATE users SET work_status=?, updated_at=? WHERE id=?", (status, now_iso(), callback.from_user.id))
    await callback.message.answer(f"Статус обновлен: {status}.")
    await callback.answer()


@dp.callback_query(F.data == "support:start")
async def support_start(callback: CallbackQuery):
    ensure_user(callback)
    await start_support_flow(callback.message, callback.from_user.id)
    await callback.answer()


@dp.callback_query(F.data.startswith("support:reply:"))
async def support_reply_start(callback: CallbackQuery):
    ensure_user(callback)
    if not is_support_admin(callback.from_user.id):
        await callback.answer()
        return
    user_id = int(callback.data.split(":")[2])
    state[callback.from_user.id] = {"flow": "support_reply", "step": "message", "user_id": user_id}
    await callback.message.answer("Напишите ответ пользователю.")
    await callback.answer()


@dp.message(F.text.in_({"Меню", "меню"}))
async def text_menu(message: Message):
    ensure_user(message)
    await send_menu(message.chat.id, message.from_user.id)


@dp.message(F.text.in_({"Создать заказ", "Новый заказ", "новый заказ"}))
async def text_new_order(message: Message):
    ensure_user(message)
    await start_order_flow(message)


@dp.message(F.text.in_({"Мои заказы", "Заказы", "заказы"}))
async def text_orders(message: Message):
    ensure_user(message)
    user = get_user(message.from_user.id)
    if user and user["role"] == "customer":
        await show_my_orders(message)
    else:
        await show_open_orders(message)


@dp.message(F.text.in_({"Новые/актуальные заказы", "Актуальные заказы", "Новые заказы"}))
async def text_open_orders(message: Message):
    ensure_user(message)
    await show_open_orders(message)


@dp.message(F.text.in_({"Мои отклики/мои предложения", "Мои отклики", "Мои предложения"}))
async def text_my_offers(message: Message):
    ensure_user(message)
    user = get_user(message.from_user.id)
    if not user or user["role"] != "executor":
        await message.answer("Отклики и предложения доступны исполнителям.")
        return
    await show_my_offers(message, message.from_user.id)


@dp.message(F.text.in_({"/мойдень", "/мой_день"}))
async def text_myday(message: Message):
    ensure_user(message)
    await send_myday(message)


@dp.message(F.text.in_({"/топ"}))
async def text_top(message: Message):
    ensure_user(message)
    await send_top(message)


@dp.message(F.text.in_({"Мой профиль", "Профиль", "профиль"}))
async def text_profile(message: Message):
    ensure_user(message)
    user = get_user(message.from_user.id)
    await message.answer(profile_text(user))
    await send_profile_files(message, user)


@dp.message(F.text.in_({"Написать в поддержку", "Поддержка"}))
async def text_support(message: Message):
    ensure_user(message)
    await start_support_flow(message)


@dp.message(F.text.in_({"Открыть кабинет", "Открыть Mini App", "Открыть мини приложение", "Mini App"}))
async def text_mini_app(message: Message):
    await command_app(message)


@dp.message(F.web_app_data)
async def webapp_data(message: Message):
    ensure_user(message)
    try:
        payload = json.loads(message.web_app_data.data)
    except json.JSONDecodeError:
        await message.answer("Mini App отправила данные в неверном формате.")
        return

    if payload.get("type") == "create_order":
        await publish_webapp_order(message, payload)
        return

    await message.answer("Mini App отправила неизвестное действие.")


@dp.message()
async def message_flow(message: Message):
    ensure_user(message)
    uid = message.from_user.id
    current = state.get(uid)
    if not current:
        user = get_user(uid)
        await message.answer(
            "Выберите действие в меню.",
            reply_markup=main_keyboard(user["role"] if user else None),
        )
        return

    flow = current["flow"]
    step = current["step"]
    text = (message.text or message.caption or "").strip()

    if flow == "profile":
        if step == "company":
            current["company"] = text
            current["step"] = "city"
            await message.answer("Город.")
            return
        if step == "city":
            current["city"] = text
            current["step"] = "phone"
            await message.answer("Телефон для связи.")
            return
        if step == "phone":
            current["phone"] = text
            current["step"] = "email"
            await message.answer("Почта.")
            return
        if step == "email":
            current["email"] = text
            current["step"] = "org_card"
            await message.answer("Прикрепите карточку организации PDF/фото или отправьте '-' чтобы пропустить.")
            return
        if step == "org_card":
            if message.document:
                current["org_card_file_id"] = message.document.file_id
                current["org_card_file_type"] = "document"
            elif message.photo:
                current["org_card_file_id"] = message.photo[-1].file_id
                current["org_card_file_type"] = "photo"
            elif text != "-":
                await message.answer("Прикрепите PDF/фото или отправьте '-'.")
                return
            if current["role"] == "customer":
                current["step"] = "company_activity"
                await message.answer(
                    "Чем занимается Ваша компания, на чем специализируетесь, что изготавливаете? "
                    "Опишите коротко."
                )
                return
            current["step"] = "specialization"
            await message.answer("Специализация производства. Например: токарка, фрезеровка, лазерная резка, сварка.")
            return
        if step == "company_activity":
            current["specialization"] = text
            current["description"] = ""
            current["work_status"] = ""
            await finish_profile(message, uid, current)
            return
        if step == "specialization":
            current["specialization"] = text
            current["step"] = "description"
            await message.answer("Коротко опишите мощности, станки, опыт и какие заказы берете в работу.")
            return
        if step == "description":
            current["description"] = text
            current["step"] = "equipment_files"
            current["equipment_files"] = []
            await message.answer(
                "Прикрепите презентацию, буклет или фото оборудования/станков на производстве. "
                "Можно несколько файлов. Когда закончите, отправьте 'готово'."
            )
            return
        if step == "equipment_files":
            if message.document:
                current["equipment_files"].append(
                    {"file_id": message.document.file_id, "file_type": "document", "caption": text}
                )
                await message.answer("Файл оборудования добавлен. Отправьте еще файл или 'готово'.")
                return
            if message.photo:
                current["equipment_files"].append(
                    {"file_id": message.photo[-1].file_id, "file_type": "photo", "caption": text}
                )
                await message.answer("Фото оборудования добавлено. Отправьте еще фото или 'готово'.")
                return
            if text.lower() not in {"готово", "готов", "нет", "-"}:
                await message.answer("Отправьте PDF/фото оборудования или напишите 'готово'.")
                return
            current["step"] = "portfolio_files"
            current["portfolio_files"] = []
            await message.answer(
                "Теперь добавьте портфолио: фото выполненных работ. "
                "Можно несколько файлов. Когда закончите, отправьте 'готово'."
            )
            return
        if step == "portfolio_files":
            if message.document:
                current["portfolio_files"].append(
                    {"file_id": message.document.file_id, "file_type": "document", "caption": text}
                )
                await message.answer("Файл портфолио добавлен. Отправьте еще файл или 'готово'.")
                return
            if message.photo:
                current["portfolio_files"].append(
                    {"file_id": message.photo[-1].file_id, "file_type": "photo", "caption": text}
                )
                await message.answer("Фото портфолио добавлено. Отправьте еще фото или 'готово'.")
                return
            if text.lower() not in {"готово", "готов", "нет", "-"}:
                await message.answer("Отправьте фото/файл портфолио или напишите 'готово'.")
                return
            current["step"] = "work_status"
            await message.answer("Выберите статус работы.", reply_markup=work_status_keyboard())
            return
        if step == "work_status":
            if text not in {"Онлайн", "Принимаю заказы", "Не в сети"}:
                await message.answer("Нажмите кнопку статуса или напишите: Онлайн, Принимаю заказы, Не в сети.")
                return
            current["work_status"] = text
            await finish_profile(message, uid, current)
            return

    if flow == "order":
        if step == "title":
            current["title"] = text
            current["step"] = "description"
            await message.answer("Описание заказа: материал, количество, операции и важные условия.")
            return
        if step == "description":
            current["description"] = text
            current["step"] = "budget"
            await message.answer("Бюджет или формат цены. Например: до 250 000 руб., договорная, нужна оценка.")
            return
        if step == "budget":
            current["budget"] = text
            current["step"] = "city"
            await message.answer("Город или регион выполнения/доставки.")
            return
        if step == "city":
            current["city"] = text
            current["step"] = "deadline"
            await message.answer("Срок выполнения. Например: до 15 июня, 10 рабочих дней, срочно.")
            return
        if step == "deadline":
            current["deadline"] = text
            current["step"] = "payment_terms"
            await message.answer("Условия оплаты: наличные/безнал, предоплата, 50/50, постоплата.")
            return
        if step == "payment_terms":
            current["payment_terms"] = text
            current["step"] = "files"
            await message.answer(
                "Прикрепите чертежи, фото или номенклатуру. Можно несколько сообщений. "
                "Когда закончите, отправьте 'готово'."
            )
            return
        if step == "files":
            if message.document:
                current["files"].append(
                    {
                        "file_id": message.document.file_id,
                        "file_type": "document",
                        "caption": text,
                    }
                )
                await message.answer("Файл добавлен. Отправьте еще файл или 'готово'.")
                return
            if message.photo:
                current["files"].append(
                    {
                        "file_id": message.photo[-1].file_id,
                        "file_type": "photo",
                        "caption": text,
                    }
                )
                await message.answer("Фото добавлено. Отправьте еще файл или 'готово'.")
                return
            if text.lower() in {"готово", "готов", "нет", "-"}:
                await finish_order(message, uid, current)
                return
            await message.answer("Отправьте файл/фото или напишите 'готово'.")
            return

    if flow == "offer":
        if step == "price":
            current["price"] = text
            current["step"] = "deadline"
            await message.answer("Ваш срок выполнения.")
            return
        if step == "deadline":
            current["deadline"] = text
            current["step"] = "comment"
            await message.answer("Комментарий заказчику: условия, вопросы, что входит в цену.")
            return
        if step == "comment":
            current["comment"] = text
            await finish_offer(message, uid, current)
            return

    if flow == "search":
        if step == "city":
            current["city"] = "" if text == "-" else text
            current["step"] = "budget"
            await message.answer("Фильтр по бюджету/ключевому слову или '-' чтобы пропустить.")
            return
        if step == "budget":
            city = current.get("city") or None
            budget = None if text == "-" else text
            state.pop(uid, None)
            await show_open_orders(message, city=city, budget=budget)
            return

    if flow == "chat":
        receiver_id = current["receiver_id"]
        order_id = current["order_id"]
        if not text:
            await message.answer("Сейчас чат принимает текстовые сообщения.")
            return
        db_execute(
            """
            INSERT INTO chat_messages(order_id, sender_id, receiver_id, text, created_at)
            VALUES(?,?,?,?,?)
            """,
            (order_id, uid, receiver_id, text, now_iso()),
        )
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="Ответить", callback_data=f"chat:with:{order_id}:{uid}")]]
        )
        sender = get_user(uid)
        if sender and sender["role"] == "executor":
            notification = f"Сообщение по заказу №{order_id} от {company_label(sender)}\n\n{text}"
        else:
            notification = f"Ответ на ваше сообщение по заказу №{order_id}\n\n{text}"
        await bot.send_message(
            receiver_id,
            notification,
            reply_markup=keyboard,
        )
        state.pop(uid, None)
        await message.answer("Сообщение отправлено.")
        return

    if flow == "support":
        if not text:
            await message.answer("Напишите текст сообщения для поддержки.")
            return
        admin_id = get_support_admin_id()
        db_execute(
            """
            INSERT INTO support_messages(user_id, admin_id, direction, text, created_at)
            VALUES(?,?,?,?,?)
            """,
            (uid, admin_id, "to_admin", text, now_iso()),
        )
        if admin_id:
            user = get_user(uid)
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[[InlineKeyboardButton(text="Ответить пользователю", callback_data=f"support:reply:{uid}")]]
            )
            await bot.send_message(
                admin_id,
                f"Сообщение в поддержку от {company_label(user)}\n"
                f"Telegram ID: {uid}\n\n{text}",
                reply_markup=keyboard,
            )
            await message.answer("Сообщение отправлено в поддержку. Ответ придет сюда в бот.")
        else:
            await message.answer(
                "Сообщение сохранено, но администратор не настроен. "
                f"Администратор @{SUPPORT_ADMIN_USERNAME} должен один раз нажать /start в этом боте."
            )
        state.pop(uid, None)
        return

    if flow == "support_reply":
        user_id = current["user_id"]
        if not text:
            await message.answer("Напишите текст ответа пользователю.")
            return
        db_execute(
            """
            INSERT INTO support_messages(user_id, admin_id, direction, text, created_at)
            VALUES(?,?,?,?,?)
            """,
            (user_id, uid, "to_user", text, now_iso()),
        )
        await bot.send_message(user_id, f"Ответ поддержки\n\n{text}")
        state.pop(uid, None)
        await message.answer("Ответ отправлен пользователю.")
        return

    if flow == "review":
        review_text = "" if text == "-" else text
        try:
            db_execute(
                """
                INSERT INTO reviews(order_id, from_user_id, to_user_id, stars, text, created_at)
                VALUES(?,?,?,?,?,?)
                """,
                (
                    current["order_id"],
                    uid,
                    current["target_id"],
                    current["stars"],
                    review_text,
                    now_iso(),
                ),
            )
            await message.answer("Оценка сохранена.")
        except sqlite3.IntegrityError:
            await message.answer("Вы уже оставляли оценку по этому заказу.")
        state.pop(uid, None)
        return


async def setup_commands():
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Запуск и выбор роли"),
            BotCommand(command="menu", description="Главное меню"),
            BotCommand(command="app", description="Открыть Mini App"),
            BotCommand(command="profile", description="Профиль компании"),
            BotCommand(command="orders", description="Заказы"),
            BotCommand(command="help", description="Короткая инструкция"),
            BotCommand(command="myday", description="Сводка дня"),
            BotCommand(command="top", description="ТОП исполнителей"),
        ]
    )
    if WEBAPP_URL:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="METAL CONNECT v4", web_app=WebAppInfo(url=WEBAPP_URL))
        )


async def main():
    if not TOKEN:
        raise RuntimeError("Set METAL_CONNECT_BOT_TOKEN environment variable before running the bot.")
    init_db()
    await setup_commands()
    logging.info("Mini App URL: %s", WEBAPP_URL or "not configured")
    logging.info("METAL CONNECT bot started")
    await dp.start_polling(bot)


def run():
    asyncio.run(main())


if __name__ == "__main__":
    run()
