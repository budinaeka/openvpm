#!/usr/bin/env bash
set -euo pipefail

DOMAIN=""
INSTALL_DIR="/opt/openvpm"
DB_NAME="openvpm"
DB_USER="openvpm"
APP_USER="openvpm"
PORT="8088"
SEED_DEMO="1"
SKIP_PACKAGES="0"

usage() {
  cat <<'USAGE'
Usage: sudo bash scripts/setup-prod-ubuntu.sh --domain DOMAIN [options]

Options:
  --domain DOMAIN          Public HTTPS domain, e.g. openvpm.example.com (required)
  --install-dir PATH       Install path (default: /opt/openvpm)
  --db-name NAME           PostgreSQL database name (default: openvpm)
  --db-user USER           PostgreSQL role/user (default: openvpm)
  --app-user USER          Linux service user (default: openvpm)
  --port PORT              Local app port (default: 8088)
  --skip-seed              Do not run pnpm db:seed
  --skip-packages          Do not apt-install Node/PostgreSQL packages
  -h, --help               Show this help

This script deploys OpenVPM without Docker: native PostgreSQL, local file
storage, standalone Next.js build, and systemd.

Run it from a cloned OpenVPM repository. It copies the repository to
--install-dir when needed.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --db-name) DB_NAME="${2:-}"; shift 2 ;;
    --db-user) DB_USER="${2:-}"; shift 2 ;;
    --app-user) APP_USER="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --skip-seed) SEED_DEMO="0"; shift ;;
    --skip-packages) SKIP_PACKAGES="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [ -z "$DOMAIN" ]; then
  echo "--domain is required" >&2
  usage
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root, e.g. sudo bash scripts/setup-prod-ubuntu.sh --domain $DOMAIN" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 32 | tr -d '\n=/+' | cut -c1-32)}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-$(openssl rand -base64 32 | tr -d '\n')}"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
UPLOAD_DIR="${INSTALL_DIR}/uploads"

echo "==> OpenVPM bare-metal setup"
echo "Domain: $DOMAIN"
echo "Install dir: $INSTALL_DIR"
echo "Database: $DB_NAME / user $DB_USER"

if [ "$SKIP_PACKAGES" = "0" ]; then
  echo "==> Installing system packages"
  apt-get update
  apt-get install -y git curl ca-certificates build-essential openssl rsync postgresql postgresql-contrib
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
fi

corepack enable
corepack prepare pnpm@9.15.0 --activate

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

mkdir -p "$INSTALL_DIR" "$UPLOAD_DIR"
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
  echo "==> Copying repository to $INSTALL_DIR"
  rsync -a --delete \
    --exclude .git \
    --exclude node_modules \
    --exclude apps/web/.next \
    --exclude uploads \
    "$SRC_DIR/" "$INSTALL_DIR/"
  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
fi

echo "==> Creating PostgreSQL role/database"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

cat > "$INSTALL_DIR/.env" <<EOF
DATABASE_URL="${DATABASE_URL}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="https://${DOMAIN}"
NEXT_PUBLIC_APP_URL="https://${DOMAIN}"
STORAGE_DRIVER="local"
LOCAL_UPLOAD_DIR="${UPLOAD_DIR}"
EOF
chown "$APP_USER:$APP_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

echo "==> Installing app dependencies"
cd "$INSTALL_DIR"
sudo -u "$APP_USER" pnpm install --frozen-lockfile

echo "==> Applying database schema"
sudo -u "$APP_USER" pnpm db:push

if [ "$SEED_DEMO" = "1" ]; then
  echo "==> Seeding demo data"
  sudo -u "$APP_USER" pnpm db:seed
fi

echo "==> Building standalone app"
sudo -u "$APP_USER" bash "$INSTALL_DIR/scripts/build-standalone.sh"

echo "==> Installing systemd service"
cat > /etc/systemd/system/openvpm.service <<EOF
[Unit]
Description=OpenVPM Next.js application
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}/apps/web/.next/standalone
EnvironmentFile=${INSTALL_DIR}/.env
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=PORT=${PORT}
Environment=HOSTNAME=127.0.0.1
Environment=NODE_OPTIONS=--max-old-space-size=1024
ExecStart=/usr/bin/node apps/web/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now openvpm.service
sleep 2
systemctl status openvpm.service --no-pager || true

echo
cat <<EOF
==> OpenVPM installed.

Local health check:
  curl http://127.0.0.1:${PORT}/api/health

Add a reverse proxy, for example Caddy:

${DOMAIN} {
  reverse_proxy 127.0.0.1:${PORT}
}

Then verify:
  bash ${INSTALL_DIR}/scripts/check-prod.sh https://${DOMAIN}

Generated database password is stored only in ${INSTALL_DIR}/.env.
EOF
