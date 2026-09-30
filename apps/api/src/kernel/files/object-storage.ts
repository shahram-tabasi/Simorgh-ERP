import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../../config.js';

export interface PutTarget {
  contentType: string;
  sizeBytes: number;
  /** Hex SHA-256 of the file; the store rejects an upload whose bytes do not match it. */
  sha256Hex: string;
}

export interface StoredObject {
  size: number;
  sha256Hex: string | null;
}

/** Where attachment bytes live (architecture ADR-09). Postgres keeps only metadata. */
export interface ObjectStorage {
  presignPut(key: string, target: PutTarget, ttlSec: number): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(key: string, fileName: string, ttlSec: number): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  ensureBucket(): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** S3 API — SeaweedFS on-prem (ADR-09), or any S3-compatible store the customer runs. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: Config) {
    this.bucket = config.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // only compute checksums the caller asked for; the client declares its own
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async presignPut(key: string, t: PutTarget, ttlSec: number) {
    const checksum = Buffer.from(t.sha256Hex, 'hex').toString('base64');
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: t.contentType,
      ContentLength: t.sizeBytes,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.s3, cmd, {
      expiresIn: ttlSec,
      // signed, so the client cannot swap type, size or content after the fact.
      // The checksum must stay a header: hoisted into the query string (the
      // presigner's default for x-amz-*) it would be signed but not sent as the
      // header the store checks the body against.
      signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      url,
      headers: {
        'content-type': t.contentType,
        'content-length': String(t.sizeBytes),
        'x-amz-checksum-sha256': checksum,
      },
    };
  }

  presignGet(key: string, fileName: string, ttlSec: number) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    return getSignedUrl(this.s3, cmd, { expiresIn: ttlSec });
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' }));
      return {
        size: r.ContentLength ?? 0,
        sha256Hex: r.ChecksumSHA256 ? Buffer.from(r.ChecksumSHA256, 'base64').toString('hex') : null,
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}
