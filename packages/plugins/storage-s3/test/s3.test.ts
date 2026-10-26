import { describe, expect, it, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { clientOptions, createS3Storage } from '../src/index.ts';

const s3 = mockClient(S3Client);
const log = { info() {}, warn() {}, error() {}, debug() {} };
const ctx = { tenantId: 'ten_1', config: { endpoint: 'http://minio:9000', bucket: 'openrent', access_key: 'k', secret_key: 's' }, logger: log };
const storage = createS3Storage();

describe('S3 storage', () => {
  beforeEach(() => s3.reset());

  it('needs a bucket and keys, and uses path-style URLs for a custom endpoint', () => {
    expect(storage.isConfigured(ctx)).toBe(true);
    expect(storage.isConfigured({ ...ctx, config: { bucket: 'b' } })).toBe(false);
    expect(clientOptions(ctx.config)).toMatchObject({ endpoint: 'http://minio:9000', forcePathStyle: true, region: 'us-east-1' });
    expect(clientOptions({ bucket: 'b' })).toMatchObject({ forcePathStyle: false });
  });

  it('puts, gets and deletes objects in the bucket', async () => {
    s3.on(PutObjectCommand).resolves({});
    s3.on(GetObjectCommand).resolves({ Body: { transformToByteArray: async () => new Uint8Array(Buffer.from('pdf bytes')) } as any });
    s3.on(DeleteObjectCommand).resolves({});
    await storage.put(ctx, 'ten_1/pdf/fil_1/a.pdf', Buffer.from('pdf bytes'), 'application/pdf');
    expect(s3.commandCalls(PutObjectCommand)[0]!.args[0].input).toMatchObject({ Bucket: 'openrent', Key: 'ten_1/pdf/fil_1/a.pdf', ContentType: 'application/pdf' });
    expect((await storage.get(ctx, 'ten_1/pdf/fil_1/a.pdf')).toString()).toBe('pdf bytes');
    await storage.delete(ctx, 'ten_1/pdf/fil_1/a.pdf');
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it('treats missing keys as absent and other failures as errors', async () => {
    s3.on(HeadObjectCommand).rejectsOnce(new NotFound({ message: 'nope', $metadata: { httpStatusCode: 404 } }));
    expect(await storage.head!(ctx, 'gone')).toBe(false);
    s3.on(DeleteObjectCommand).rejectsOnce(new NoSuchKey({ message: 'nope', $metadata: { httpStatusCode: 404 } }));
    await expect(storage.delete(ctx, 'gone')).resolves.toBeUndefined();
    s3.reset();
    s3.on(HeadObjectCommand).rejects(new S3ServiceException({ name: 'AccessDenied', $fault: 'client', message: 'denied', $metadata: { httpStatusCode: 403 } }));
    await expect(storage.head!(ctx, 'x')).rejects.toThrow('denied');
  });
});
