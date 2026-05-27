#!/usr/bin/env bash
set -euo pipefail

API_SET_URL="${METAL_CONNECT_LOCAL_API_SET_URL:-http://127.0.0.1:8091/api/set_ngrok_url}"
NGROK_TUNNELS_URL="${METAL_CONNECT_NGROK_TUNNELS_URL:-http://127.0.0.1:4040/api/tunnels}"

echo "Waiting for ngrok tunnel at ${NGROK_TUNNELS_URL}..."

for _ in $(seq 1 60); do
  NGROK_URL="$(
    python3 - "$NGROK_TUNNELS_URL" <<'PY'
import json
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1], timeout=2) as response:
        data = json.loads(response.read().decode("utf-8"))
except Exception:
    sys.exit(1)

for tunnel in data.get("tunnels", []):
    public_url = tunnel.get("public_url", "")
    if public_url.startswith("https://"):
        print(public_url)
        sys.exit(0)

sys.exit(1)
PY
  )" && break

  sleep 1
done

if [ -z "${NGROK_URL:-}" ]; then
  echo "ngrok HTTPS tunnel not found" >&2
  exit 1
fi

echo "Ngrok URL: ${NGROK_URL}"

python3 - "$API_SET_URL" "$NGROK_URL" <<'PY'
import json
import sys
import urllib.request

api_url = sys.argv[1]
ngrok_url = sys.argv[2]
payload = json.dumps({"url": ngrok_url}).encode("utf-8")
request = urllib.request.Request(
    api_url,
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=5) as response:
    print(response.read().decode("utf-8"))
PY
