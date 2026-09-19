#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/check-prod.sh [BASE_URL]

Examples:
  scripts/check-prod.sh http://127.0.0.1:8088
  scripts/check-prod.sh https://openvpm.example.com

Checks:
  - /api/health returns JSON and ok=true
  - login page returns HTTP 200
  - optional systemd service state when run on the host
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

BASE_URL="${1:-${NEXT_PUBLIC_APP_URL:-${NEXTAUTH_URL:-http://127.0.0.1:8088}}}"
BASE_URL="${BASE_URL%/}"

echo "==> Checking OpenVPM at $BASE_URL"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

HEALTH_BODY="$(mktemp)"
trap 'rm -f "$HEALTH_BODY"' EXIT

HEALTH_CODE="$(curl -sS -o "$HEALTH_BODY" -w '%{http_code}' "$BASE_URL/api/health")"
if [ "$HEALTH_CODE" != "200" ]; then
  echo "Health check failed with HTTP $HEALTH_CODE" >&2
  cat "$HEALTH_BODY" >&2 || true
  exit 1
fi

python3 - "$HEALTH_BODY" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
if not data.get("ok"):
    print("/api/health returned ok=false", file=sys.stderr)
    print(json.dumps(data, indent=2), file=sys.stderr)
    sys.exit(1)
print("health ok:", json.dumps({"service": data.get("service"), "mode": data.get("mode"), "latencyMs": data.get("latencyMs")}))
PY

LOGIN_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/login")"
case "$LOGIN_CODE" in
  200|302) echo "login route ok: HTTP $LOGIN_CODE" ;;
  *) echo "login route unexpected HTTP $LOGIN_CODE" >&2; exit 1 ;;
esac

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files openvpm.service >/dev/null 2>&1; then
  if systemctl is-active --quiet openvpm.service; then
    echo "systemd service ok: openvpm.service active"
  else
    echo "systemd service warning: openvpm.service is not active" >&2
  fi
fi

echo "==> OpenVPM check passed"
