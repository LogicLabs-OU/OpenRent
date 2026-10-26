import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { definePlugin, type ProviderContext, type StorageProvider } from '@openrent/plugin-sdk';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Client options from a shop's settings (or the operator's S3_* environment defaults). */
export function clientOptions(config: Record<string, unknown>) {
  const endpoint = str(config.endpoint);
  return {
    region: str(config.region) ?? 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    // MinIO and most self-hosted stores need path-style URLs (http://host/bucket/key).
    forcePathStyle: config.force_path_style === true || config.force_path_style === 'true' || (!!endpoint && config.force_path_style !== false && config.force_path_style !== 'false'),
    credentials: { accessKeyId: String(config.access_key ?? ''), secretAccessKey: String(config.secret_key ?? '') },
  };
}

const clients = new Map<string, S3Client>();
function client(config: Record<string, unknown>) {
  const opts = clientOptions(config);
  const key = JSON.stringify(opts);
  let c = clients.get(key);
  if (!c) {
    c = new S3Client(opts);
    clients.set(key, c);
  }
  return c;
}

const bucket = (ctx: ProviderContext) => String(ctx.config.bucket);
const missing = (err: unknown) => err instanceof S3ServiceException && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404);

export function createS3Storage(): StorageProvider {
  return {
    id: 's3',
    isConfigured: (ctx) => !!(str(ctx.config.bucket) && str(ctx.config.access_key) && str(ctx.config.secret_key)),
    async put(ctx, key, body, contentType) {
      await client(ctx.config).send(new PutObjectCommand({ Bucket: bucket(ctx), Key: key, Body: body, ContentType: contentType }));
    },
    async get(ctx, key) {
      const r = await client(ctx.config).send(new GetObjectCommand({ Bucket: bucket(ctx), Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async delete(ctx, key) {
      try {
        await client(ctx.config).send(new DeleteObjectCommand({ Bucket: bucket(ctx), Key: key }));
      } catch (err) {
        if (!missing(err)) throw err;
      }
    },
    async head(ctx, key) {
      try {
        await client(ctx.config).send(new HeadObjectCommand({ Bucket: bucket(ctx), Key: key }));
        return true;
      } catch (err) {
        if (missing(err)) return false;
        throw err;
      }
    },
  };
}

export default definePlugin({
  id: 'storage-s3',
  name: 'S3 file storage',
  version: '0.1.0',
  author: 'OpenRent',
  license: 'AGPL-3.0-only',
  compat: '^1.0.0',
  permissions: ['files:store'],
  settings: [
    { key: 'endpoint', label: 'Endpoint', type: 'text', help: 'Leave empty for AWS; for MinIO or another store, e.g. http://minio:9000' },
    { key: 'region', label: 'Region', type: 'text', help: 'us-east-1 when unsure' },
    { key: 'bucket', label: 'Bucket', type: 'text', required: true },
    { key: 'access_key', label: 'Access key', type: 'text', required: true },
    { key: 'secret_key', label: 'Secret key', type: 'secret', required: true },
    { key: 'force_path_style', label: 'Path-style URLs', type: 'boolean', help: 'Needed for MinIO; on by default when an endpoint is set' },
  ],
  setup(api) {
    api.setDefaultConfig({
      endpoint: api.env('S3_ENDPOINT'),
      region: api.env('S3_REGION'),
      bucket: api.env('S3_BUCKET'),
      access_key: api.env('S3_ACCESS_KEY'),
      secret_key: api.env('S3_SECRET_KEY'),
      force_path_style: api.env('S3_FORCE_PATH_STYLE'),
    });
    api.registerStorageProvider(createS3Storage());
  },
});
