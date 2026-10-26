import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { themeAssetFile } from '#lib/server/theme-assets.ts';
import type { RequestHandler } from './$types';

/** A theme asset by its hashed name; the hash makes it safe to cache for good. */
export const GET: RequestHandler = async ({ params }) => {
  const asset = themeAssetFile(params.id, params.file);
  if (!asset) error(404);
  return new Response(new Uint8Array(await readFile(asset.file)), {
    headers: { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
};
