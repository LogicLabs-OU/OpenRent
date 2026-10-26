/**
 * Back-office API client. The admin uses only the public /api/v1 endpoints (PRD §2.1),
 * authenticated by the session cookie plus the double-submit CSRF header.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem: any,
  ) {
    super(message);
  }
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.problem?.errors ?? []) out[e.field] = e.message;
    return out;
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)or_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

export async function request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf() } : {}),
      ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/') && !location.pathname.endsWith('/login')) {
      location.href = `/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(res.status, data?.code ?? 'http_error', data?.detail ?? res.statusText, data);
  }
  return data as T;
}

/** Uploads one file as multipart/form-data (POST /files?purpose=…). */
export async function upload<T = any>(path: string, file: File | Blob, filename = (file as File).name ?? 'upload'): Promise<T> {
  const form = new FormData();
  form.append('file', file, filename);
  const res = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() }, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'http_error', data?.detail ?? res.statusText, data);
  return data as T;
}

/** Downloads an authenticated file (exports) with the server's file name. */
export async function download(path: string) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const p = await res.json().catch(() => ({}));
    throw new ApiError(res.status, p?.code ?? 'http_error', p?.detail ?? res.statusText, p);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}, h?: Record<string, string>) => request<T>('POST', p, b, h),
  patch: <T = any>(p: string, b: unknown, h?: Record<string, string>) => request<T>('PATCH', p, b, h),
  put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

/**
 * Opens an authenticated HTML or PDF response in a new tab. The tab is opened before the request
 * so browsers treat it as part of the click and do not block it as a pop-up.
 */
export async function openHtml(path: string, body?: unknown) {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(`/api/v1${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const p = await res.json().catch(() => ({}));
      throw new ApiError(res.status, p?.code ?? 'http_error', p?.detail ?? res.statusText, p);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener');
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export const qs = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
