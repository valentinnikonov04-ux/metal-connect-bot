import os
import sqlite3
from contextlib import closing

from metal_connect_app.config import load_dotenv


load_dotenv()

DB_PATH = os.getenv("METAL_CONNECT_SITE_DB", "metal_connect_site.db")


def connect_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def db_execute(sql: str, params=()):
    with closing(connect_db()) as con:
        cur = con.cursor()
        cur.execute(sql, params)
        con.commit()
        return cur.lastrowid


def db_one(sql: str, params=()):
    with closing(connect_db()) as con:
        cur = con.cursor()
        cur.execute(sql, params)
        return cur.fetchone()


def db_all(sql: str, params=()):
    with closing(connect_db()) as con:
        cur = con.cursor()
        cur.execute(sql, params)
        return cur.fetchall()


def init_db():
    with closing(connect_db()) as con:
        cur = con.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS users(
                id INTEGER PRIMARY KEY,
                username TEXT,
                full_name TEXT,
                role TEXT,
                company TEXT,
                city TEXT,
                phone TEXT,
                email TEXT,
                org_card_file_id TEXT,
                org_card_file_type TEXT,
                specialization TEXT,
                description TEXT,
                work_status TEXT DEFAULT 'Принимаю заказы',
                created_at TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS orders(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                budget TEXT NOT NULL,
                city TEXT NOT NULL,
                deadline TEXT NOT NULL,
                payment_terms TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                selected_executor_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS customers(
                user_id INTEGER PRIMARY KEY,
                company TEXT,
                city TEXT,
                phone TEXT,
                customer_type TEXT,
                created_at TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS executors(
                user_id INTEGER PRIMARY KEY,
                company TEXT,
                city TEXT,
                phone TEXT,
                email TEXT,
                specialization TEXT,
                description TEXT,
                work_status TEXT,
                created_at TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS order_files(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                file_id TEXT NOT NULL,
                file_type TEXT NOT NULL,
                caption TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS offers(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                executor_id INTEGER NOT NULL,
                price TEXT NOT NULL,
                deadline TEXT NOT NULL,
                comment TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL,
                UNIQUE(order_id, executor_id)
            );

            CREATE TABLE IF NOT EXISTS chat_messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                file_id TEXT,
                file_type TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                from_user_id INTEGER NOT NULL,
                to_user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                file_id TEXT,
                file_type TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS favorites(
                user_id INTEGER NOT NULL,
                target_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, target_id)
            );

            CREATE TABLE IF NOT EXISTS favorite_orders(
                user_id INTEGER NOT NULL,
                order_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, order_id)
            );

            CREATE TABLE IF NOT EXISTS reviews(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER,
                from_user_id INTEGER NOT NULL,
                to_user_id INTEGER NOT NULL,
                stars INTEGER NOT NULL,
                text TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(order_id, from_user_id, to_user_id)
            );

            CREATE TABLE IF NOT EXISTS executor_equipment_files(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executor_id INTEGER NOT NULL,
                file_id TEXT NOT NULL,
                file_type TEXT NOT NULL,
                caption TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS portfolio_files(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executor_id INTEGER NOT NULL,
                file_id TEXT NOT NULL,
                file_type TEXT NOT NULL,
                caption TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS portfolio(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                file_id TEXT NOT NULL,
                file_type TEXT NOT NULL,
                description TEXT,
                equipment TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS support_messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                admin_id INTEGER,
                direction TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        existing_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(users)").fetchall()
        }
        auth_columns = {
            "email": "TEXT",
            "password_hash": "TEXT",
            "telegram_id": "INTEGER",
        }
        for column, definition in auth_columns.items():
            if column not in existing_columns:
                cur.execute(f"ALTER TABLE users ADD COLUMN {column} {definition}")
        if "work_status" not in existing_columns:
            cur.execute("ALTER TABLE users ADD COLUMN work_status TEXT DEFAULT 'Принимаю заказы'")

        order_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(orders)").fetchall()
        }
        if "material" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN material TEXT")
        if "quantity" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN quantity INTEGER DEFAULT 0")
        if "urgency" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN urgency TEXT")
        if "file_preview" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN file_preview TEXT")
        if "photo_id" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN photo_id TEXT")
        if "file_id" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN file_id TEXT")
        if "file_type" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN file_type TEXT")
        if "executor_id" not in order_columns:
            cur.execute("ALTER TABLE orders ADD COLUMN executor_id INTEGER")
        cur.execute(
            """
            UPDATE orders
            SET executor_id=selected_executor_id
            WHERE executor_id IS NULL
              AND selected_executor_id IS NOT NULL
            """
        )

        chat_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(chat_messages)").fetchall()
        }
        if "file_id" not in chat_columns:
            cur.execute("ALTER TABLE chat_messages ADD COLUMN file_id TEXT")
        if "file_type" not in chat_columns:
            cur.execute("ALTER TABLE chat_messages ADD COLUMN file_type TEXT")

        message_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(messages)").fetchall()
        }
        if "file_id" not in message_columns:
            cur.execute("ALTER TABLE messages ADD COLUMN file_id TEXT")
        if "file_type" not in message_columns:
            cur.execute("ALTER TABLE messages ADD COLUMN file_type TEXT")

        cur.execute(
            """
            INSERT INTO messages(order_id, from_user_id, to_user_id, text, file_id, file_type, created_at)
            SELECT order_id, sender_id, receiver_id, text, COALESCE(file_id, ''), COALESCE(file_type, ''), created_at
            FROM chat_messages
            WHERE NOT EXISTS (
                SELECT 1 FROM messages
                WHERE messages.order_id=chat_messages.order_id
                  AND messages.from_user_id=chat_messages.sender_id
                  AND messages.to_user_id=chat_messages.receiver_id
                  AND messages.text=chat_messages.text
                  AND messages.created_at=chat_messages.created_at
            )
            """
        )

        portfolio_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(portfolio_files)").fetchall()
        }
        if "equipment" not in portfolio_columns:
            cur.execute("ALTER TABLE portfolio_files ADD COLUMN equipment TEXT")
        if "description" not in portfolio_columns:
            cur.execute("ALTER TABLE portfolio_files ADD COLUMN description TEXT")

        portfolio_table_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(portfolio)").fetchall()
        }
        if "equipment" not in portfolio_table_columns:
            cur.execute("ALTER TABLE portfolio ADD COLUMN equipment TEXT")
        if "description" not in portfolio_table_columns:
            cur.execute("ALTER TABLE portfolio ADD COLUMN description TEXT")

        cur.execute(
            """
            INSERT INTO portfolio(user_id, file_id, file_type, description, equipment, created_at)
            SELECT executor_id, file_id, file_type, COALESCE(description, caption, ''), COALESCE(equipment, ''), created_at
            FROM portfolio_files
            WHERE NOT EXISTS (
                SELECT 1 FROM portfolio
                WHERE portfolio.user_id=portfolio_files.executor_id
                  AND portfolio.file_id=portfolio_files.file_id
                  AND portfolio.created_at=portfolio_files.created_at
            )
            """
        )

        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS executor_calendar(
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, day)
            );

            CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_id, status);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            CREATE INDEX IF NOT EXISTS idx_orders_executor_status ON orders(selected_executor_id, status);
            CREATE INDEX IF NOT EXISTS idx_orders_executor_id_status ON orders(executor_id, status);
            CREATE INDEX IF NOT EXISTS idx_offers_order_status ON offers(order_id, status);
            CREATE INDEX IF NOT EXISTS idx_offers_executor_status ON offers(executor_id, status);
            CREATE INDEX IF NOT EXISTS idx_offers_executor_order_status ON offers(executor_id, order_id, status);
            CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, id);
            CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(from_user_id, to_user_id);
            CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
            CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id);
            CREATE INDEX IF NOT EXISTS idx_calendar_user_day ON executor_calendar(user_id, day);
            """
        )
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS site_sessions(
                jti TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                revoked INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
            ON users(email)
            WHERE email IS NOT NULL AND email != '';

            CREATE INDEX IF NOT EXISTS idx_site_sessions_user
            ON site_sessions(user_id, revoked);
            """
        )
        con.commit()
