import { describe, expect, it } from 'vitest';
import { createS3Storage } from '../src/index.ts';

/** Against a real S3-compatible store (CI runs MinIO): S3_TEST_ENDPOINT, S3_TEST_BUCKET, S3_TEST_ACCESS_KEY, S3_TEST_SECRET_KEY. */
const endpoint = process.env.S3_TEST_ENDPOINT;
const suite = endpoint ? describe : describe.skip;

suite('S3 storage against a real store', () => {
  const storage = createS3Storage();
  const ctx = {
    tenantId: 'ten_test',
    config: { endpoint, bucket: process.env.S3_TEST_BUCKET ?? 'openrent', access_key: process.env.S3_TEST_ACCESS_KEY, secret_key: process.env.S3_TEST_SECRET_KEY },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  it('round-trips an object and deletes it', async () => {
    const key = `ten_test/pdf/fil_${Date.now()}/a.pdf`;
    await storage.put(ctx, key, Buffer.from('%PDF-1.7 test'), 'application/pdf');
    expect(await storage.head!(ctx, key)).toBe(true);
    expect((await storage.get(ctx, key)).toString()).toBe('%PDF-1.7 test');
    await storage.delete(ctx, key);
    expect(await storage.head!(ctx, key)).toBe(false);
    await storage.delete(ctx, key);
  });
});
