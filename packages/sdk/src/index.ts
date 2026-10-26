import createFetchClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './types.ts';

export type { paths, components, operations } from './types.ts';
export { verifyWebhook } from './webhooks.ts';

export interface OpenRentOptions {
  /** Base URL of the installation, e.g. https://rent.example.com */
  baseUrl: string;
  /** sk_live_... for servers, pk_live_... for browsers (storefront namespace only). */
  apiKey?: string;
  /** Storefront calls without a key: the shop slug. */
  tenantSlug?: string;
  fetch?: typeof fetch;
  /** Retries for 429, 502, 503, 504 and network errors (safe or keyed requests only). */
  retries?: number;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

export class OpenRentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem: Record<string, any>,
  ) {
    super(message);
    this.name = 'OpenRentError';
  }
}

const RETRY = new Set([429, 502, 503, 504]);
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Typed client generated from the OpenAPI document (FR-INT-1).
 * Adds an Idempotency-Key to every POST, retries with backoff, and throws OpenRentError on problems.
 */
export function createClient(opts: OpenRentOptions) {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = opts.retries ?? 2;
  const retryingFetch = async (input: Request): Promise<Response> => {
    const canRetry = SAFE.has(input.method) || input.headers.has('Idempotency-Key');
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await baseFetch(input.clone());
        if (!RETRY.has(res.status) || !canRetry || attempt >= retries) return res;
        const after = Number(res.headers.get('Retry-After'));
        await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? after * 1000 : 250 * 2 ** attempt));
      } catch (err) {
        if (!canRetry || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  };
  const client = createFetchClient<paths>({ baseUrl: opts.baseUrl.replace(/\/$/, ''), fetch: retryingFetch, credentials: opts.credentials, headers: opts.headers });
  const auth: Middleware = {
    onRequest({ request }) {
      if (opts.apiKey) request.headers.set('Authorization', `Bearer ${opts.apiKey}`);
      if (opts.tenantSlug) request.headers.set('X-Tenant-Slug', opts.tenantSlug);
      if (request.method === 'POST' && !request.headers.has('Idempotency-Key')) request.headers.set('Idempotency-Key', uuid());
      return request;
    },
    async onResponse({ response }) {
      if (response.ok) return response;
      let body: any = {};
      try {
        body = await response.clone().json();
      } catch {
        /* not JSON */
      }
      throw new OpenRentError(response.status, body.code ?? 'http_error', body.detail ?? response.statusText, body);
    },
  };
  client.use(auth);
  return client;
}

export type OpenRentClient = ReturnType<typeof createClient>;
