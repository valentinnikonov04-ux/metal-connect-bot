import sqlite3
from contextlib import closing

from metal_connect_app.config import DB_PATH


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

        chat_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(chat_messages)").fetchall()
        }
        if "file_id" not in chat_columns:
            cur.execute("ALTER TABLE chat_messages ADD COLUMN file_id TEXT")
        if "file_type" not in chat_columns:
            cur.execute("ALTER TABLE chat_messages ADD COLUMN file_type TEXT")

        portfolio_columns = {
            row["name"] for row in cur.execute("PRAGMA table_info(portfolio_files)").fetchall()
        }
        if "equipment" not in portfolio_columns:
            cur.execute("ALTER TABLE portfolio_files ADD COLUMN equipment TEXT")
        if "description" not in portfolio_columns:
            cur.execute("ALTER TABLE portfolio_files ADD COLUMN description TEXT")

        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS executor_calendar(
                user_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, day)
            );
            """
        )
        con.commit()
