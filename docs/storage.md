# File storage

OpenVPM supports two storage drivers for uploads and generated files:

| Driver | Best for | Requires |
|---|---|---|
| `local` | Development, small VPSes, simple self-hosting | Writable directory on disk |
| `s3` | Multi-server deployments, managed object storage, large installs | S3-compatible bucket and credentials |

The application always serves uploaded files through the same-origin proxy route
`/api/files/<key>`. This keeps private files auth-gated and avoids exposing raw
storage URLs to browsers.

## Local filesystem storage (default)

```env
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=.data/uploads
```

For production, use an absolute path outside build output:

```env
STORAGE_DRIVER=local
LOCAL_UPLOAD_DIR=/opt/openvpm/uploads
```

Local mode writes:

```text
<LOCAL_UPLOAD_DIR>/<practiceId>/<category>/<uuid>-<filename>
<LOCAL_UPLOAD_DIR>/<practiceId>/<category>/<uuid>-<filename>.content-type
```

The `.content-type` sidecar preserves MIME metadata so the file proxy can return
safe `Content-Type` and `Content-Disposition` headers.

### Backup requirement

When using local storage, back up both:

1. PostgreSQL database
2. `LOCAL_UPLOAD_DIR`

Example:

```bash
pg_dump "$DATABASE_URL" > openvpm-db-$(date +%F).sql
tar -czf openvpm-uploads-$(date +%F).tgz /opt/openvpm/uploads
```

## S3-compatible storage

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=openpims
S3_SECRET_KEY=openpims123
S3_BUCKET=openpims
S3_REGION=us-east-1
```

`S3_ENDPOINT` can point to MinIO, AWS S3, Cloudflare R2, Wasabi, or another
S3-compatible object store. The bucket must exist and the credentials need
read/write/delete/head permissions.

When `STORAGE_DRIVER` is unset, OpenVPM keeps backwards compatibility:

- If `S3_ENDPOINT` or `S3_BUCKET` is set, it uses `s3`.
- Otherwise it uses `local`.

## Migrating from MinIO/S3 to local storage

1. Stop writes briefly, or put the app in maintenance mode.
2. Mirror bucket contents to the local upload directory while preserving keys.
3. Create `.content-type` sidecars for existing files from the database `files`
   table or object metadata.
4. Set:

   ```env
   STORAGE_DRIVER=local
   LOCAL_UPLOAD_DIR=/opt/openvpm/uploads
   ```

5. Restart the app.
6. Verify `/api/files/<existing-key>` returns HTTP 200.
7. Disable MinIO/S3 only after verification.

Example MinIO mirror:

```bash
mc mirror --overwrite local/openpims /opt/openvpm/uploads
```

## Migrating from local storage to S3/MinIO

1. Create the bucket.
2. Mirror uploads into the bucket:

   ```bash
   mc mirror --overwrite /opt/openvpm/uploads local/openpims
   ```

3. Set `STORAGE_DRIVER=s3` and the `S3_*` envs.
4. Restart the app.
5. Verify existing `/api/files/<key>` URLs.

## Security notes

- The file proxy validates keys and rejects path traversal.
- `branding` uploads are public images so logos render in email/portal contexts.
- Other categories are tenant-private and require an authenticated user from the
  owning practice.
- Never commit `LOCAL_UPLOAD_DIR`, `.env`, bucket credentials, or database dumps.
