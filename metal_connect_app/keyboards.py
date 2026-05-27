from typing import Optional

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from metal_connect_app.config import WEBAPP_URL


def mini_app_button() -> KeyboardButton:
    if WEBAPP_URL:
        return KeyboardButton(text="Открыть кабинет", web_app=WebAppInfo(url=WEBAPP_URL))
    return KeyboardButton(text="Открыть кабинет")


def main_keyboard(role: Optional[str] = None) -> ReplyKeyboardMarkup:
    if role == "customer":
        keyboard = [
            [mini_app_button()],
            [KeyboardButton(text="Мой профиль"), KeyboardButton(text="Мои заказы")],
            [KeyboardButton(text="Создать заказ"), KeyboardButton(text="Написать в поддержку")],
        ]
    elif role == "executor":
        keyboard = [
            [mini_app_button()],
            [KeyboardButton(text="Новые/актуальные заказы"), KeyboardButton(text="Мой профиль")],
            [KeyboardButton(text="Мои отклики/мои предложения"), KeyboardButton(text="Написать в поддержку")],
        ]
    else:
        keyboard = [
            [mini_app_button()],
            [KeyboardButton(text="Меню"), KeyboardButton(text="Профиль")],
            [KeyboardButton(text="Написать в поддержку")],
        ]

    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True,
        input_field_placeholder="Выберите действие",
    )


def inline_menu(role: Optional[str] = None, is_admin: bool = False) -> InlineKeyboardMarkup:
    rows = []
    if WEBAPP_URL:
        rows.append([InlineKeyboardButton(text="Открыть кабинет", web_app=WebAppInfo(url=WEBAPP_URL))])
    if role == "customer":
        rows.extend(
            [
                [InlineKeyboardButton(text="Разместить заказ", callback_data="order:new")],
                [InlineKeyboardButton(text="Мои активные заказы", callback_data="orders:mine")],
                [InlineKeyboardButton(text="Исполненные/завершенные заказы", callback_data="orders:archive")],
                [InlineKeyboardButton(text="Исполнители", callback_data="users:executors")],
                [InlineKeyboardButton(text="Исполнители в Избранном", callback_data="favorites:list")],
            ]
        )
    elif role == "executor":
        rows.extend(
            [
                [InlineKeyboardButton(text="Новые заказы", callback_data="orders:open")],
                [InlineKeyboardButton(text="Мои отклики", callback_data="offers:mine")],
                [InlineKeyboardButton(text="Избранные заказы", callback_data="favorite_orders:list")],
                [InlineKeyboardButton(text="Заказчики в Избранном", callback_data="favorites:list")],
                [InlineKeyboardButton(text="Личный кабинет", callback_data="profile:view")],
                [InlineKeyboardButton(text="Статус работы", callback_data="work_status:menu")],
                [InlineKeyboardButton(text="Заказчики", callback_data="users:customers")],
            ]
        )
    else:
        rows.append([InlineKeyboardButton(text="Я заказчик", callback_data="role:customer")])
        rows.append([InlineKeyboardButton(text="Я исполнитель", callback_data="role:executor")])

    rows.extend(
        [
            [InlineKeyboardButton(text="Профиль", callback_data="profile:view")],
            [InlineKeyboardButton(text="ТОП участников", callback_data="top:list")],
            [InlineKeyboardButton(text="Короткая инструкция", callback_data="help:view")],
            [InlineKeyboardButton(text="Написать в поддержку", callback_data="support:start")],
        ]
    )
    if is_admin:
        rows.insert(-1, [InlineKeyboardButton(text="Статистика", callback_data="stats:view")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def role_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Заказчик", callback_data="role:customer"),
                InlineKeyboardButton(text="Исполнитель", callback_data="role:executor"),
            ]
        ]
    )


def order_keyboard(order_id: int, role: Optional[str], owner_id: Optional[int] = None) -> InlineKeyboardMarkup:
    rows = []

    if role == "executor":
        rows = [
            [InlineKeyboardButton(text="Откликнуться", callback_data=f"offer:new:{order_id}")],
            [InlineKeyboardButton(text="Написать по заказу", callback_data=f"chat:start:{order_id}")],
        ]

    if role == "customer" and owner_id:
        rows = [
            [InlineKeyboardButton(text="Отклики", callback_data=f"offers:order:{order_id}")],
            [InlineKeyboardButton(text="Статус", callback_data=f"status:menu:{order_id}")],
            [InlineKeyboardButton(text="Написать исполнителю", callback_data=f"chat:start:{order_id}")],
        ]

    rows.append([InlineKeyboardButton(text="В меню", callback_data="menu")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def status_keyboard(order_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Новый", callback_data=f"status:set:{order_id}:new")],
            [InlineKeyboardButton(text="В работе", callback_data=f"status:set:{order_id}:work")],
            [InlineKeyboardButton(text="Завершен", callback_data=f"status:set:{order_id}:done")],
            [InlineKeyboardButton(text="Отменен", callback_data=f"status:set:{order_id}:cancelled")],
        ]
    )


def support_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Написать в поддержку", callback_data="support:start")]]
    )


def publish_more_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Опубликовать еще один", callback_data="order:new")],
            [InlineKeyboardButton(text="Мои активные заказы", callback_data="orders:mine")],
        ]
    )


def work_status_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Онлайн", callback_data="work_status:set:Онлайн")],
            [InlineKeyboardButton(text="Принимаю заказы", callback_data="work_status:set:Принимаю заказы")],
            [InlineKeyboardButton(text="Не в сети", callback_data="work_status:set:Не в сети")],
        ]
    )
