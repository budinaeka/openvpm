# Bare-metal Ubuntu deployment (no Docker)

This guide deploys OpenVPM directly on an Ubuntu VPS with native PostgreSQL, a
systemd service, and an HTTPS reverse proxy. It is the lightest production path
for small servers because it avoids Docker and MinIO overhead.

For a container-based path, see [deployment-docker.md](deployment-docker.md).

## Architecture

```text
Internet → Caddy/Nginx HTTPS → 127.0.0.1:8088 → OpenVPM Next.js standalone
                                      ↘ PostgreSQL 16 on localhost
                                      ↘ local uploads directory
```

The default file storage mode is local filesystem:

```env
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=/opt/openvpm/uploads
```

S3-compatible storage (MinIO, AWS S3, Cloudflare R2, Wasabi) remains optional by
setting `STORAGE_DRIVER=s3` and the `S3_*` variables.

## Requirements

- Ubuntu 22.04/24.04 or compatible Debian-based VPS
- Domain pointing to the server
- 2 GB RAM minimum recommended for builds; use swap on small VPSes
- Node.js 20+
- pnpm 9
- PostgreSQL 16+
- Caddy or Nginx for TLS/reverse proxy

## One-command helper path

From a fresh server:

```bash
git clone https://github.com/budinaeka/openvpm.git
cd openvpm
sudo bash scripts/setup-prod-ubuntu.sh \
  --domain openvpm.example.com \
  --install-dir /opt/openvpm \
  --db-name openvpm \
  --db-user openvpm
```

The setup helper installs system packages, creates a database/user, copies an
`.env`, installs dependencies, applies the schema with `pnpm db:push`, seeds demo
data unless skipped, builds the app, installs `openvpm.service`, and prints the
next reverse-proxy step.

If you prefer manual control, follow the sections below.

## Manual deployment

### 1. Install OS packages

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential openssl postgresql postgresql-contrib

# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

corepack enable
corepack prepare pnpm@9.15.0 --activate
```

### 2. Create an app user and directory

```bash
sudo useradd --system --create-home --shell /bin/bash openvpm || true
sudo mkdir -p /opt/openvpm /opt/openvpm/uploads
sudo chown -R openvpm:openvpm /opt/openvpm
```

### 3. Clone and install dependencies

```bash
sudo -u openvpm git clone https://github.com/budinaeka/openvpm.git /opt/openvpm
cd /opt/openvpm
sudo -u openvpm corepack enable
sudo -u openvpm pnpm install --frozen-lockfile
```

### 4. Create PostgreSQL database

Generate a password first:

```bash
DB_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
echo "$DB_PASSWORD"
```

Then create the DB and role:

```bash
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openvpm') THEN
    CREATE ROLE openvpm LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE openvpm WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
CREATE DATABASE openvpm OWNER openvpm;
SQL
```

### 5. Configure `.env`

```bash
cd /opt/openvpm
sudo -u openvpm cp .env.example .env
NEXTAUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')
sudo -u openvpm tee .env >/dev/null <<EOF
DATABASE_URL="postgresql://openvpm:${DB_PASSWORD}@localhost:5432/openvpm"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="https://openvpm.example.com"
NEXT_PUBLIC_APP_URL="https://openvpm.example.com"
STORAGE_DRIVER="local"
LOCAL_UPLOAD_DIR="/opt/openvpm/uploads"
EOF
```

Add optional integrations (Resend, Telnyx/Twilio, Stripe, Kirimdev, AI provider)
later as needed. Self-host mode is fully unlocked when `HOSTED_BILLING_ENABLED`
is unset.

### 6. Apply schema and seed demo data

```bash
cd /opt/openvpm
sudo -u openvpm pnpm db:push
sudo -u openvpm pnpm db:seed
```

Demo login after seeding:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@neighborhoodvet.example.com` | `password123` |
| Veterinarian | `sarah.chen@neighborhoodvet.example.com` | `password123` |
| Technician | `jamie.torres@neighborhoodvet.example.com` | `password123` |
| Front Desk | `morgan.bailey@neighborhoodvet.example.com` | `password123` |

### 7. Build standalone Next.js output

```bash
cd /opt/openvpm
sudo -u openvpm bash scripts/build-standalone.sh
```

Equivalent manual command:

```bash
cd /opt/openvpm/apps/web
sudo -u openvpm NODE_OPTIONS='--max-old-space-size=4096' pnpm next build
sudo -u openvpm cp -a .next/static .next/standalone/apps/web/.next/static
```

### 8. Install systemd service

Create `/etc/systemd/system/openvpm.service`:

```ini
[Unit]
Description=OpenVPM Next.js application
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=openvpm
Group=openvpm
WorkingDirectory=/opt/openvpm/apps/web/.next/standalone
EnvironmentFile=/opt/openvpm/.env
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=PORT=8088
Environment=HOSTNAME=127.0.0.1
Environment=NODE_OPTIONS=--max-old-space-size=1024
ExecStart=/usr/bin/node apps/web/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openvpm.service
sudo systemctl status openvpm.service --no-pager
```

### 9. Add HTTPS reverse proxy

#### Caddy

```caddy
openvpm.example.com {
  reverse_proxy 127.0.0.1:8088
}
```

Reload:

```bash
sudo systemctl reload caddy
```

#### Nginx

```nginx
server {
  listen 80;
  server_name openvpm.example.com;

  location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Use Certbot or another ACME client for HTTPS when using Nginx.

### 10. Verify

```bash
bash scripts/check-prod.sh https://openvpm.example.com
```

Or manually:

```bash
curl -fsS https://openvpm.example.com/api/health | jq .
sudo journalctl -u openvpm.service -n 100 --no-pager
```

## Updating an existing bare-metal install

```bash
cd /opt/openvpm
git pull
pnpm install --frozen-lockfile
pnpm db:migrate   # or pnpm db:push for small self-host installs
bash scripts/build-standalone.sh
sudo systemctl restart openvpm.service
bash scripts/check-prod.sh https://openvpm.example.com
```

## Backups

Minimum viable backup:

```bash
pg_dump "$DATABASE_URL" > "openvpm-$(date +%F).sql"
tar -czf "openvpm-uploads-$(date +%F).tgz" /opt/openvpm/uploads
```

Automate both with cron or systemd timers. If using local storage, database
backups alone are not enough: uploaded files live in `LOCAL_UPLOAD_DIR`.

## Troubleshooting

### Build fails with out-of-memory

Add swap or lower the build heap:

```bash
NODE_OPTIONS='--max-old-space-size=1536' bash scripts/build-standalone.sh
```

### `Upload failed`

Check `LOCAL_UPLOAD_DIR` exists and is writable by the service user:

```bash
sudo -u openvpm test -w /opt/openvpm/uploads && echo writable
```

### App starts but login fails

Confirm `.env` contains the same `NEXTAUTH_SECRET` across restarts and the public
URL matches `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL`.

### Database connection fails

```bash
sudo -u openvpm psql "$DATABASE_URL" -c 'select 1'
```

If that fails, inspect the database name, user, password, and `pg_hba.conf`.
