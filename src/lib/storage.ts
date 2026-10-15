import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";
import { ServiceUnavailableError } from "./AppError";
import { logger } from "./logger";

// The only file that knows about S3. Works against any S3-compatible server
// (MinIO locally; Supabase Storage / Backblaze B2 / Cloudflare R2 / S3 in
// production) — switching is env vars only. The bucket must stay PRIVATE: files
// are only ever reached through short-lived signed URLs.

function settings() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    // The server boots without storage (like RabbitMQ); only document
    // endpoints are unavailable.
    throw new ServiceUnavailableError("Document storage is not configured");
  }
  return { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY };
}

function makeClient(endpoint: string): S3Client {
  const s = settings();
  return new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: true, // MinIO and most S3-compatible hosts need path-style URLs
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
}

let internalClient: S3Client | undefined;
let presignClient: S3Client | undefined;

// Reads/writes: the host the APP can reach (inside docker: http://minio:9000).
function client(): S3Client {
  internalClient ??= makeClient(settings().endpoint);
  return internalClient;
}

// Signing is offline, so it uses the host the BROWSER can reach
// (http://localhost:9000). A signed URL is only valid for the host it was signed for.
function signer(): S3Client {
  presignClient ??= makeClient(env.S3_PUBLIC_ENDPOINT ?? settings().endpoint);
  return presignClient;
}

let bucketReady: Promise<void> | undefined;

function ensureBucket(): Promise<void> {
  const { bucket } = settings();
  bucketReady ??= (async () => {
    try {
      await client().send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client().send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })().catch((err) => {
    bucketReady = undefined; // retry on the next call instead of caching the failure
    throw err;
  });
  return bucketReady;
}

// An unreachable or failing storage server is an outage of document storage, not
// a bug in the app: the caller gets a 503 saying so (the cause is logged), where
// it used to get a bare 500. A missing configuration is already a 503 (settings()).
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await ensureBucket();
    await client().send(
      new PutObjectCommand({ Bucket: settings().bucket, Key: key, Body: body, ContentType: contentType }),
    );
  } catch (err) {
    if (err instanceof ServiceUnavailableError) {
      throw err;
    }
    logger.error({ err, key }, "Document storage request failed");
    throw new ServiceUnavailableError("Document storage is unavailable right now, please try again shortly");
  }
}

// Best-effort: a failed delete only leaves an orphan object, never a bad row.
export async function deleteObject(key: string): Promise<void> {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: settings().bucket, Key: key }));
  } catch (err) {
    logger.warn({ err, key }, "Failed to delete stored object");
  }
}

// Forces a download (never inline rendering) with a server-chosen content type.
export function getSignedDownloadUrl(key: string, contentType: string, expiresInSeconds = 60): Promise<string> {
  return getSignedUrl(
    signer(),
    new GetObjectCommand({
      Bucket: settings().bucket,
      Key: key,
      ResponseContentDisposition: "attachment",
      ResponseContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}
