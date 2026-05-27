import os


def load_dotenv(path: str = ".env"):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as file:
        for raw_line in file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ[key] = value


load_dotenv()

TOKEN = os.getenv("METAL_CONNECT_BOT_TOKEN", "").strip()
DB_PATH = os.getenv("METAL_CONNECT_DB", "metal_connect_market.db")
SUPPORT_ADMIN_ID = int(os.getenv("METAL_CONNECT_SUPPORT_ADMIN_ID", "0") or 0)
SUPPORT_ADMIN_USERNAME = os.getenv("METAL_CONNECT_SUPPORT_ADMIN_USERNAME", "valentinn_nikonov").lstrip("@").lower()
WEBAPP_URL = os.getenv("METAL_CONNECT_WEBAPP_URL", "").strip()
API_URL = os.getenv("METAL_CONNECT_API_URL", "").strip()
API_HOST = os.getenv("METAL_CONNECT_API_HOST", "127.0.0.1").strip()
API_PORT = int(os.getenv("METAL_CONNECT_API_PORT", "8091") or 8091)
API_CORS_ORIGIN = os.getenv("METAL_CONNECT_API_CORS_ORIGIN", "https://valentinnikonov04-ux.github.io").strip()
