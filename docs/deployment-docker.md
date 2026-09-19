# Docker deployment

OpenVPM can run with Docker Compose for local evaluation and simple self-hosted
installations. Docker is more reproducible for first-time testers, while the
bare-metal path is lighter for small VPS production installs.

- Bare-metal/no-Docker guide: [deployment-bare-metal.md](deployment-bare-metal.md)
- Storage guide: [storage.md](storage.md)

## Development quickstart with PostgreSQL only

The default OpenVPM storage driver is local filesystem, so MinIO is not required
for local development.

```bash
git clone https://github.com/budinaeka/openvpm.git
cd openvpm
cp .env.example .env

# Start only PostgreSQL
docker compose -f docker/docker-compose.yml up -d postgres

corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm db:push
pnpm db:seed
pnpm dev
```

Open <http://localhost:3000> and sign in with:

```text
admin@neighborhoodvet.example.com / password123
```

## Full app stack with Docker Compose

The Compose file can also build and run the web app:

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d --build
```

The web container listens on <http://localhost:3000>.

## Services

| Service | Purpose | Ports |
|---|---|---|
| `postgres` | PostgreSQL 16 database | `5432` |
| `web` | OpenVPM Next.js app | `3000` |

Local uploads are stored in the `web_uploads` Docker volume when running the web
container. No MinIO container is required by default.

## Optional S3/MinIO profile

If you want to test S3-compatible storage instead of local filesystem storage,
start the optional `storage` profile:

```bash
docker compose -f docker/docker-compose.yml --profile storage up -d minio minio-bootstrap
```

Then set the app environment to:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=openpims
S3_SECRET_KEY=openpims123
S3_BUCKET=openpims
S3_REGION=us-east-1
```

For host-local development outside Docker, use `S3_ENDPOINT=http://localhost:9000`.
For the Docker `web` service, use `S3_ENDPOINT=http://minio:9000`.

## Production notes

Docker Compose can be used in production, but for small VPSes the bare-metal
systemd deployment is usually lighter and easier to inspect. If you do run Docker
in production:

1. Generate strong values for `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, and any
   provider keys.
2. Use `STORAGE_DRIVER=local` with a persistent volume, or use a managed S3/R2
   bucket with backups.
3. Put Caddy/Nginx/Traefik in front for HTTPS.
4. Back up both PostgreSQL data and uploads.
5. Do not expose PostgreSQL publicly unless you know why.

## Common commands

```bash
# Start database only
docker compose -f docker/docker-compose.yml up -d postgres

# Start full stack
docker compose -f docker/docker-compose.yml up -d --build

# Logs
docker compose -f docker/docker-compose.yml logs -f web

# Stop
docker compose -f docker/docker-compose.yml down

# Remove volumes too (destructive)
docker compose -f docker/docker-compose.yml down -v
```
