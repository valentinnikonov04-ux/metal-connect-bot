import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEBAPP_DIR = ROOT / "metal_connect_app" / "webapp"
ENV_PATH = ROOT / ".env"
PYTHON = sys.executable
PORT = os.environ.get("METAL_CONNECT_WEBAPP_PORT", "8088")
SERVEO_URL_RE = re.compile(r"https://[^\s]+\.serveousercontent\.com")


def write_env(webapp_url: str):
    values = {}
    if ENV_PATH.exists():
        for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            if "=" not in raw_line or raw_line.strip().startswith("#"):
                continue
            key, value = raw_line.split("=", 1)
            values[key.strip()] = value.strip()

    values["METAL_CONNECT_WEBAPP_URL"] = webapp_url
    values.setdefault("METAL_CONNECT_SUPPORT_ADMIN_USERNAME", "valentinn_nikonov")

    ENV_PATH.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )


def log(message: str):
    print(message, flush=True)


def start_process(args, **kwargs):
    return subprocess.Popen(
        args,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        **kwargs,
    )


def wait_for_tunnel_url(process, timeout=25):
    started = time.time()
    while time.time() - started < timeout:
        line = process.stdout.readline()
        if line:
            log(f"[tunnel] {line.rstrip()}")
            match = SERVEO_URL_RE.search(line)
            if match:
                return match.group(0)
        elif process.poll() is not None:
            raise RuntimeError("HTTPS-туннель завершился раньше, чем выдал ссылку.")
    raise RuntimeError("Не дождался HTTPS-ссылки от туннеля.")


def stream_output(name, process):
    try:
        for line in process.stdout:
            log(f"[{name}] {line.rstrip()}")
    except ValueError:
        pass


def stop_process(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def start_http_server():
    log(f"Starting Mini App server on http://127.0.0.1:{PORT}")
    process = start_process(
        [PYTHON, "-m", "http.server", PORT, "--directory", str(WEBAPP_DIR)]
    )
    time.sleep(1)
    if process.poll() is not None:
        raise RuntimeError("Mini App server не запустился. Возможно, порт уже занят.")
    return process


def start_tunnel():
    log("Starting HTTPS tunnel via serveo.net")
    process = start_process(
        ["ssh", "-o", "StrictHostKeyChecking=no", "-R", f"80:localhost:{PORT}", "serveo.net"]
    )
    webapp_url = wait_for_tunnel_url(process)
    log("")
    log(f"Mini App HTTPS URL: {webapp_url}")
    log("URL используется только для этого запуска и не записывается в .env")
    log("")
    return process, webapp_url


def start_bot(webapp_url: str):
    log("Starting Telegram bot")
    env = os.environ.copy()
    env["METAL_CONNECT_WEBAPP_URL"] = webapp_url
    return subprocess.Popen(
        [PYTHON, "metal_connect_simple_working.py"],
        cwd=ROOT,
        env=env,
    )


def main():
    if os.environ.get("METAL_CONNECT_ALLOW_TEMP_TUNNEL") != "1":
        raise SystemExit(
            "Этот скрипт запускает временный Serveo-туннель и не подходит для стабильной работы.\n"
            "Для обычного запуска используйте: python3 metal_connect_simple_working.py\n"
            "Для разработки с временным туннелем: METAL_CONNECT_ALLOW_TEMP_TUNNEL=1 python3 scripts/run_with_miniapp.py"
        )

    http_server = None
    tunnel = None
    bot = None

    try:
        http_server = start_http_server()
        tunnel, webapp_url = start_tunnel()
        bot = start_bot(webapp_url)

        while True:
            if http_server.poll() is not None:
                raise RuntimeError("Локальный Mini App сервер остановился.")

            if bot.poll() is not None:
                raise RuntimeError("Бот остановился.")

            if tunnel.poll() is not None:
                log("")
                log("HTTPS-туннель остановился. Поднимаю новый URL и перезапускаю бота...")
                stop_process(bot)
                bot = None
                tunnel, webapp_url = start_tunnel()
                bot = start_bot(webapp_url)

            time.sleep(1)

    except KeyboardInterrupt:
        log("\nStopping bot, tunnel and Mini App server...")
    finally:
        stop_process(bot)
        stop_process(tunnel)
        stop_process(http_server)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.default_int_handler)
    main()
