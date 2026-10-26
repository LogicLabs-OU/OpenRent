import { json } from '@sveltejs/kit';
import { sf, SfError } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const v = event.url.searchParams.get('variant_id') ?? '';
  const m = event.url.searchParams.get('month') ?? '';
  try {
    return json(await sf(event, `/availability?variant_id=${encodeURIComponent(v)}&month=${encodeURIComponent(m)}`), { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (e) {
    if (e instanceof SfError) return json({ message: e.message }, { status: e.status });
    throw e;
  }
};
