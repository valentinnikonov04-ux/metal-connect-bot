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

CREATE TABLE IF NOT EXISTS portfolio(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_id TEXT NOT NULL,
    file_type TEXT NOT NULL,
    description TEXT,
    equipment TEXT,
    created_at TEXT NOT NULL
);

INSERT INTO portfolio(user_id, file_id, file_type, description, equipment, created_at)
SELECT executor_id, file_id, file_type, COALESCE(description, caption, ''), COALESCE(equipment, ''), created_at
FROM portfolio_files
WHERE NOT EXISTS (
    SELECT 1 FROM portfolio
    WHERE portfolio.user_id=portfolio_files.executor_id
      AND portfolio.file_id=portfolio_files.file_id
      AND portfolio.created_at=portfolio_files.created_at
);

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
);

UPDATE orders
SET executor_id=selected_executor_id
WHERE executor_id IS NULL
  AND selected_executor_id IS NOT NULL;

-- Columns portfolio_files.equipment and portfolio_files.description are added idempotently
-- by metal_connect_app.database.init_db(), because SQLite versions differ on
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS support.

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
