import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { S3ObjectStorage } from '../src/kernel/files/object-storage.js';

// Runs against a real S3 API (SeaweedFS in CI and compose) when
// S3_TEST_ENDPOINT is set; the in-memory store covers the flow otherwise.
const endpoint = process.env.S3_TEST_ENDPOINT;

describe.skipIf(!endpoint)('S3 object storage adapter', () => {
  const storage = new S3ObjectStorage(
    loadConfig({
      DATABASE_URL: 'postgres://unused',
      JWT_SECRET: 'x'.repeat(32),
      S3_ENDPOINT: endpoint,
      // one bucket, reused across runs — the product also uses a single bucket;
      // per-run keys below keep runs apart. (SeaweedFS pre-allocates volumes per bucket.)
      S3_BUCKET: 'simorgh-test',
      S3_ACCESS_KEY: process.env.S3_TEST_ACCESS_KEY ?? 'test',
      S3_SECRET_KEY: process.env.S3_TEST_SECRET_KEY ?? 'test-secret',
    }),
  );
  const body = Buffer.from('نقشه تک‌خطی — revision 2');
  const sha256Hex = createHash('sha256').update(body).digest('hex');

  it('uploads through a presigned PUT, verifies with HEAD, downloads through a presigned GET', async () => {
    await storage.ensureBucket();
    const key = `tenant/eng.design/${Date.now()}/file`;
    const put = await storage.presignPut(key, { contentType: 'application/pdf', sizeBytes: body.length, sha256Hex }, 60);
    const up = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    expect(up.status).toBe(200);

    const head = await storage.head(key);
    expect(head?.size).toBe(body.length);
    if (head?.sha256Hex) expect(head.sha256Hex).toBe(sha256Hex);

    const get = await fetch(await storage.presignGet(key, 'SLD.pdf', 60));
    expect(Buffer.from(await get.arrayBuffer()).equals(body)).toBe(true);
    expect(await storage.head('tenant/missing')).toBeNull();
  });

  it('signs content type, length and checksum into the upload URL', async () => {
    const put = await storage.presignPut('k', { contentType: 'application/pdf', sizeBytes: body.length, sha256Hex }, 60);
    const signed = new URL(put.url).searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];
    expect(signed).toEqual(expect.arrayContaining(['content-type', 'content-length', 'x-amz-checksum-sha256']));
  });

  // Only stores that verify signatures can prove the negative (SeaweedFS with credentials does; moto does not).
  it.skipIf(process.env.S3_TEST_ENFORCES_SIGNATURES !== '1')('rejects a presigned PUT replayed with other content', async () => {
    const key = `tenant/eng.design/${Date.now()}/other`;
    const put = await storage.presignPut(key, { contentType: 'application/pdf', sizeBytes: body.length, sha256Hex }, 60);
    const up = await fetch(put.url, { method: 'PUT', headers: { ...put.headers, 'content-type': 'text/html' }, body });
    expect(up.status).toBe(403);
    const other = Buffer.alloc(body.length, 0x41);
    const swapped = await fetch(put.url, { method: 'PUT', headers: put.headers, body: other });
    expect(swapped.status).toBeGreaterThanOrEqual(400);
  });
});
