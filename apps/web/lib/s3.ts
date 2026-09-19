import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export type StorageDriver = "local" | "s3";

function storageEnv(name: string): string | undefined {
  const trimmed = process.env[name]?.trim();
  return trimmed ? trimmed : undefined;
}

function storageDriver(): StorageDriver {
  const configured = storageEnv("STORAGE_DRIVER")?.toLowerCase();
  if (configured === "local" || configured === "file" || configured === "fs") {
    return "local";
  }
  if (configured === "s3" || configured === "minio" || configured === "r2") {
    return "s3";
  }

  // Backwards-compatible default: existing installs with S3_* envs continue to
  // use object storage. Fresh/reproducible installs without S3 envs use local
  // filesystem storage and do not need MinIO. Uses raw (untrimmed) presence so
  // blank-but-set values still count as "configured".
  const s3Configured =
    (process.env.S3_ENDPOINT?.length ?? 0) > 0 ||
    (process.env.S3_BUCKET?.length ?? 0) > 0;
  return s3Configured ? "s3" : "local";
}

function bucketName(): string {
  return storageEnv("S3_BUCKET") ?? "openpims";
}

function storageEndpoint(): string | undefined {
  return storageEnv("S3_ENDPOINT");
}

function publicStorageEndpoint(): string {
  return storageEndpoint() ?? "https://s3.amazonaws.com";
}

function localUploadDir(): string {
  return path.resolve(
    storageEnv("LOCAL_UPLOAD_DIR") ??
      path.join(process.cwd(), process.env.NODE_ENV === "production" ? "uploads" : ".data/uploads"),
  );
}

function safeLocalObjectPath(key: string): string | null {
  const parts = key.split("/");
  if (
    parts.length < 2 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        part.includes("\0"),
    )
  ) {
    return null;
  }

  const root = localUploadDir();
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function contentTypeSidecarPath(filePath: string): string {
  return `${filePath}.content-type`;
}

function s3Client(): S3Client {
  return new S3Client({
    endpoint: storageEndpoint(),
    region: storageEnv("S3_REGION") ?? "us-east-1",
    credentials: {
      accessKeyId: storageEnv("S3_ACCESS_KEY") ?? "",
      secretAccessKey: storageEnv("S3_SECRET_KEY") ?? "",
    },
    forcePathStyle: true, // Required for MinIO / S3-compatible stores
  });
}

export const OBJECT_STORAGE_HEALTH_TIMEOUT_MS = 5_000;

/**
 * Upload a file to the configured storage backend.
 *
 * @param key   Object key, e.g. `{practiceId}/{category}/{uuid}-{filename}`
 * @param body  File contents as a Buffer
 * @param contentType  MIME type of the file
 * @returns The raw backend URL/path of the uploaded object
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (storageDriver() === "local") {
    const filePath = safeLocalObjectPath(key);
    if (!filePath) throw new Error("Invalid storage key");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, { mode: 0o600 });
    await fs.writeFile(contentTypeSidecarPath(filePath), contentType, { mode: 0o600 });
    return `file://${filePath}`;
  }

  const bucket = bucketName();
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  // Build the URL from the endpoint so it works for both AWS S3 and MinIO
  return `${publicStorageEndpoint()}/${bucket}/${key}`;
}

/**
 * Read an object's bytes + content type. Used by the same-origin file proxy
 * (`/api/files/...`) so uploaded images serve through the app instead of the
 * private R2/S3 API endpoint (which rejects unauthenticated <img> requests).
 *
 * @param key Object key in storage
 * @param options.maxBytes Optional byte cap for callers that proxy object bytes
 * @returns The object bytes + content type, or null if it does not exist.
 */
export async function getObject(
  key: string,
  options: { maxBytes?: number } = {},
): Promise<{ body: Uint8Array; contentType?: string } | null> {
  if (storageDriver() === "local") {
    try {
      const filePath = safeLocalObjectPath(key);
      if (!filePath) return null;
      const stat = await fs.stat(filePath);
      if (
        typeof options.maxBytes === "number" &&
        stat.size > options.maxBytes
      ) {
        return null;
      }
      const body = await fs.readFile(filePath);
      if (
        typeof options.maxBytes === "number" &&
        body.byteLength > options.maxBytes
      ) {
        return null;
      }

      let contentType: string | undefined;
      try {
        contentType = (await fs.readFile(contentTypeSidecarPath(filePath), "utf8")).trim() || undefined;
      } catch {
        contentType = undefined;
      }
      return { body, contentType };
    } catch {
      return null;
    }
  }

  try {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: bucketName(), Key: key }),
    );
    if (
      typeof options.maxBytes === "number" &&
      typeof res.ContentLength === "number" &&
      res.ContentLength > options.maxBytes
    ) {
      return null;
    }

    const body = await res.Body?.transformToByteArray();
    if (!body) return null;
    if (
      typeof options.maxBytes === "number" &&
      body.byteLength > options.maxBytes
    ) {
      return null;
    }
    return { body, contentType: res.ContentType };
  } catch {
    return null;
  }
}

/**
 * Generate a read URL for a private object.
 *
 * For local storage this returns the app's authenticated same-origin proxy URL;
 * for S3/MinIO it returns a pre-signed GET URL.
 */
export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  if (storageDriver() === "local") {
    const filePath = safeLocalObjectPath(key);
    if (!filePath) throw new Error("Invalid storage key");
    return `/api/files/${key}`;
  }

  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  });

  return awsGetSignedUrl(s3Client(), command, { expiresIn });
}

/**
 * Delete an object from the configured storage backend.
 *
 * @param key Object key to delete
 */
export async function deleteFile(key: string): Promise<void> {
  if (storageDriver() === "local") {
    const filePath = safeLocalObjectPath(key);
    if (!filePath) return;
    await fs.rm(filePath, { force: true });
    await fs.rm(contentTypeSidecarPath(filePath), { force: true });
    return;
  }

  await s3Client().send(
    new DeleteObjectCommand({
      Bucket: bucketName(),
      Key: key,
    }),
  );
}

export async function checkObjectStorageHealth(
  options: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; detail: string }> {
  if (storageDriver() === "local") {
    try {
      const dir = localUploadDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir);
      return { ok: true, detail: "Local file storage directory reachable" };
    } catch {
      return { ok: false, detail: "Local file storage check failed" };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? OBJECT_STORAGE_HEALTH_TIMEOUT_MS,
  );

  try {
    await s3Client().send(
      new HeadBucketCommand({
        Bucket: bucketName(),
      }),
      { abortSignal: controller.signal },
    );
    return { ok: true, detail: "Object storage bucket reachable" };
  } catch (err) {
    void err;
    return { ok: false, detail: "Object storage check failed" };
  } finally {
    clearTimeout(timeout);
  }
}
