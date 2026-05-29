import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
NGROK_URL_PATH = ROOT / ".ngrok_url"
PYTHON = sys.executable
API_PORT = int(os.environ.get("METAL_CONNECT_API_PORT", "8091") or 8091)
NGROK_UI_PORT = int(os.environ.get("METAL_CONNECT_NGROK_UI_PORT", "4040") or 4040)
API_LOCAL_URL = f"http://127.0.0.1:{API_PORT}"
NGROK_API_URL = f"http://127.0.0.1:{NGROK_UI_PORT}/api/tunnels"


processes = []


def log(message):
    print(message, flush=True)


def run_checked(args):
    subprocess.run(args, cwd=ROOT, check=True)


def command_output(args):
    return subprocess.check_output(args, cwd=ROOT, text=True).strip()


def kill_port(port):
    if os.environ.get("METAL_CONNECT_KEEP_EXISTING") == "1":
        return
    try:
        raw = command_output(["lsof", "-ti", f"tcp:{port}"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    for pid in [item for item in raw.splitlines() if item.strip()]:
        if pid == str(os.getpid()):
            continue
        log(f"Останавливаю старый процесс на порту {port}: PID {pid}")
        subprocess.run(["kill", pid], check=False)
    time.sleep(0.6)


def kill_matching_processes(patterns):
    if os.environ.get("METAL_CONNECT_KEEP_EXISTING") == "1":
        return
    try:
        raw = command_output(["pgrep", "-f", "|".join(patterns)])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    for pid in [item for item in raw.splitlines() if item.strip()]:
        if pid == str(os.getpid()):
            continue
        log(f"Останавливаю старый процесс бота/API: PID {pid}")
        subprocess.run(["kill", pid], check=False)
    time.sleep(0.6)


def start_process(name, args, env=None):
    log(f"Запускаю {name}...")
    process = subprocess.Popen(
        args,
        cwd=ROOT,
        env=env or os.environ.copy(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
    )
    processes.append((name, process))
    threading.Thread(target=stream_output, args=(name, process), daemon=True).start()
    return process


def stream_output(name, process):
    try:
        for line in process.stdout:
            log(f"[{name}] {line.rstrip()}")
    except ValueError:
        return


def wait_for_url(url, name, timeout=30):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return response.read().decode("utf-8")
        except Exception as exc:
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f"{name} не ответил за {timeout} секунд: {last_error}")


def wait_for_ngrok_url(timeout=45):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(NGROK_API_URL, timeout=2) as response:
                data = json.loads(response.read().decode("utf-8"))
            for tunnel in data.get("tunnels", []):
                public_url = tunnel.get("public_url", "")
                if public_url.startswith("https://"):
                    return public_url.rstrip("/")
        except Exception as exc:
            last_error = exc
        time.sleep(0.7)
    raise RuntimeError(f"ngrok не выдал HTTPS URL за {timeout} секунд: {last_error}")


def read_env():
    values = {}
    order = []
    if not ENV_PATH.exists():
        return values, order
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        values[key] = value.strip()
        order.append(key)
    return values, order


def write_env_key(key, value):
    values, order = read_env()
    if key not in values:
        order.append(key)
    values[key] = value
    ENV_PATH.write_text("\n".join(f"{item}={values[item]}" for item in order) + "\n", encoding="utf-8")


def post_ngrok_url(url):
    payload = json.dumps({"url": url}).encode("utf-8")
    request = urllib.request.Request(
        f"{API_LOCAL_URL}/api/set_ngrok_url",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return response.read().decode("utf-8")


def stop_all():
    for name, process in reversed(processes):
        if process.poll() is not None:
            continue
        log(f"Останавливаю {name}...")
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def find_ngrok_binary():
    local = ROOT / "ngrok"
    if local.exists():
        return str(local)
    return "ngrok"


def main():
    log("METAL CONNECT: единый запуск API + ngrok + бот")
    log("Остановить всё: Ctrl+C")

    kill_port(API_PORT)
    kill_port(NGROK_UI_PORT)
    kill_matching_processes([
        "metal_connect_simple_working.py",
        "metal_connect_app.app",
    ])

    log("Обновляю БД...")
    run_checked([PYTHON, "-c", "from metal_connect_app.database import init_db; init_db(); print('БД готова')"])

    api = start_process("api", [PYTHON, "metal_connect_api.py"])
    wait_for_url(f"{API_LOCAL_URL}/api/get_ngrok_url", "API")

    ngrok = start_process("ngrok", [find_ngrok_binary(), "http", str(API_PORT)])
    ngrok_url = wait_for_ngrok_url()
    log(f"ngrok HTTPS URL: {ngrok_url}")

    write_env_key("METAL_CONNECT_API_URL", ngrok_url)
    NGROK_URL_PATH.write_text(ngrok_url + "\n", encoding="utf-8")
    log(post_ngrok_url(ngrok_url))

    bot_env = os.environ.copy()
    bot_env["METAL_CONNECT_API_URL"] = ngrok_url
    bot = start_process("bot", [PYTHON, "metal_connect_simple_working.py"], env=bot_env)

    values, _ = read_env()
    log("")
    log("Готово. Открой Telegram, отправь /start и заново открой Mini App.")
    log(f"Mini App URL: {values.get('METAL_CONNECT_WEBAPP_URL', 'не задан')}")
    log(f"API URL: {ngrok_url}")
    log("")

    while True:
        for name, process in [(name, process) for name, process in processes]:
            if process.poll() is not None:
                raise RuntimeError(f"{name} остановился с кодом {process.returncode}")
        time.sleep(1)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.default_int_handler)
    try:
        main()
    except KeyboardInterrupt:
        log("\nОстанавливаю все процессы...")
    finally:
        stop_all()
