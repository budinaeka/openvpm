import { mkdtempSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const send = vi.fn();

  return {
    send,
    S3Client: vi.fn(() => ({ send })),
    PutObjectCommand: vi.fn((input: unknown) => ({ input })),
    GetObjectCommand: vi.fn((input: unknown) => ({ input })),
    DeleteObjectCommand: vi.fn((input: unknown) => ({ input })),
    HeadBucketCommand: vi.fn((input: unknown) => ({ input })),
    getSignedUrl: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: mocks.S3Client,
  PutObjectCommand: mocks.PutObjectCommand,
  GetObjectCommand: mocks.GetObjectCommand,
  DeleteObjectCommand: mocks.DeleteObjectCommand,
  HeadBucketCommand: mocks.HeadBucketCommand,
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const {
  OBJECT_STORAGE_HEALTH_TIMEOUT_MS,
  checkObjectStorageHealth,
  deleteFile,
  getObject,
  uploadFile,
} = await import("../s3");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  // Default every suite to the S3 driver; the local-driver suite overrides.
  vi.stubEnv("STORAGE_DRIVER", "s3");
});

describe("S3 uploads", () => {
  beforeEach(() => {
    // These suites exercise the S3 driver explicitly.
    vi.stubEnv("STORAGE_DRIVER", "s3");
  });

  it("trims configured storage env values before creating objects and URLs", async () => {
    vi.stubEnv("S3_ENDPOINT", " https://storage.example ");
    vi.stubEnv("S3_REGION", " us-east-1 ");
    vi.stubEnv("S3_ACCESS_KEY", " access ");
    vi.stubEnv("S3_SECRET_KEY", "\tsecret\n");
    vi.stubEnv("S3_BUCKET", " clinic-private-bucket ");
    mocks.send.mockResolvedValueOnce({});

    await expect(
      uploadFile(
        "practice-1/branding/logo.png",
        Buffer.from("logo"),
        "image/png"
      )
    ).resolves.toBe(
      "https://storage.example/clinic-private-bucket/practice-1/branding/logo.png"
    );

    expect(mocks.S3Client).toHaveBeenCalledWith({
      endpoint: "https://storage.example",
      region: "us-east-1",
      credentials: {
        accessKeyId: "access",
        secretAccessKey: "secret",
      },
      forcePathStyle: true,
    });
    expect(mocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "clinic-private-bucket",
      Key: "practice-1/branding/logo.png",
      Body: Buffer.from("logo"),
      ContentType: "image/png",
    });
  });

  it("falls back from blank storage env values instead of passing whitespace to S3", async () => {
    vi.stubEnv("S3_ENDPOINT", "   ");
    vi.stubEnv("S3_REGION", "\t");
    vi.stubEnv("S3_ACCESS_KEY", " ");
    vi.stubEnv("S3_SECRET_KEY", "\n");
    vi.stubEnv("S3_BUCKET", "   ");
    mocks.send.mockResolvedValueOnce({});

    await expect(
      uploadFile("practice-1/files/lab.pdf", Buffer.from("pdf"), "application/pdf")
    ).resolves.toBe("https://s3.amazonaws.com/openpims/practice-1/files/lab.pdf");

    expect(mocks.S3Client).toHaveBeenCalledWith({
      endpoint: undefined,
      region: "us-east-1",
      credentials: {
        accessKeyId: "",
        secretAccessKey: "",
      },
      forcePathStyle: true,
    });
    expect(mocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "openpims",
      Key: "practice-1/files/lab.pdf",
      Body: Buffer.from("pdf"),
      ContentType: "application/pdf",
    });
  });
});

describe("S3 object reads", () => {
  it("rejects oversized objects from provider metadata before buffering", async () => {
    const transformToByteArray = vi.fn(async () => new Uint8Array([1, 2, 3]));
    mocks.send.mockResolvedValueOnce({
      Body: { transformToByteArray },
      ContentLength: 11,
      ContentType: "image/png",
    });

    await expect(getObject("practice/documents/lab.pdf", { maxBytes: 10 }))
      .resolves.toBeNull();
    expect(transformToByteArray).not.toHaveBeenCalled();
  });

  it("rejects oversized objects after buffering when metadata is unavailable", async () => {
    mocks.send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: vi.fn(async () => new Uint8Array(11)),
      },
      ContentType: "application/pdf",
    });

    await expect(getObject("practice/documents/lab.pdf", { maxBytes: 10 }))
      .resolves.toBeNull();
  });

  it("returns object bytes within the caller byte cap", async () => {
    const body = new Uint8Array([1, 2, 3]);
    mocks.send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: vi.fn(async () => body),
      },
      ContentLength: body.byteLength,
      ContentType: "image/png",
    });

    await expect(getObject("practice/branding/logo.png", { maxBytes: 10 }))
      .resolves.toEqual({ body, contentType: "image/png" });
  });
});

describe("S3 health checks", () => {
  it("checks bucket reachability with a bounded HeadBucket request", async () => {
    mocks.send.mockResolvedValueOnce({});

    await expect(checkObjectStorageHealth({ timeoutMs: 1234 })).resolves.toEqual(
      {
        ok: true,
        detail: "Object storage bucket reachable",
      }
    );

    expect(mocks.HeadBucketCommand).toHaveBeenCalledWith({
      Bucket: "openpims",
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: "openpims" },
      }),
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      })
    );
    expect(OBJECT_STORAGE_HEALTH_TIMEOUT_MS).toBe(5_000);
  });

  it("returns a sanitized storage health failure", async () => {
    mocks.send.mockRejectedValueOnce(
      new Error("AccessDenied bucket=openpims secret=abc123")
    );

    await expect(checkObjectStorageHealth()).resolves.toEqual({
      ok: false,
      detail: "Object storage check failed",
    });
  });
});

describe("local file storage driver", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("LOCAL_UPLOAD_DIR", "");
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "openvpm-local-store-"));
    vi.stubEnv("LOCAL_UPLOAD_DIR", tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes uploads next to a content-type sidecar and returns a file URL", async () => {
    const url = await uploadFile(
      "practice-1/branding/logo.png",
      Buffer.from("logo"),
      "image/png",
    );

    expect(url).toBe(
      `file://${path.join(tmpDir, "practice-1/branding/logo.png")}`,
    );
    const stored = await fs.readFile(
      path.join(tmpDir, "practice-1/branding/logo.png"),
    );
    expect(stored.toString()).toBe("logo");
    await expect(
      fs.readFile(
        path.join(tmpDir, "practice-1/branding/logo.png.content-type"),
        "utf8",
      ),
    ).resolves.toBe("image/png");
  });

  it("round-trips objects with their stored content type", async () => {
    await uploadFile(
      "practice-1/documents/lab.pdf",
      Buffer.from("pdf"),
      "application/pdf",
    );

    await expect(
      getObject("practice-1/documents/lab.pdf", { maxBytes: 10 }),
    ).resolves.toEqual({
      body: Buffer.from("pdf"),
      contentType: "application/pdf",
    });
  });

  it("rejects oversized local objects before buffering", async () => {
    await uploadFile(
      "practice-1/documents/big.pdf",
      Buffer.alloc(11, 1),
      "application/pdf",
    );

    await expect(
      getObject("practice-1/documents/big.pdf", { maxBytes: 10 }),
    ).resolves.toBeNull();
  });

  it("returns null for objects outside the upload root", async () => {
    await expect(
      getObject("../../etc/passwd"),
    ).resolves.toBeNull();
    await expect(getObject("practice-1/branding/../../etc/passwd"))
      .resolves.toBeNull();
  });

  it("deletes objects and sidecars", async () => {
    await uploadFile(
      "practice-1/branding/old.png",
      Buffer.from("old"),
      "image/png",
    );

    await deleteFile("practice-1/branding/old.png");

    await expect(
      fs.stat(path.join(tmpDir, "practice-1/branding/old.png")),
    ).rejects.toThrow();
    await expect(
      fs.stat(path.join(tmpDir, "practice-1/branding/old.png.content-type")),
    ).rejects.toThrow();
  });

  it("reports local storage health from the upload directory", async () => {
    await expect(checkObjectStorageHealth()).resolves.toEqual({
      ok: true,
      detail: "Local file storage directory reachable",
    });
  });
});
