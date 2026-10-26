import { redirect } from '@sveltejs/kit';
import { setPreview } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Ends a theme preview and returns to the live storefront. */
export const GET: RequestHandler = async (event) => {
  setPreview(event.cookies, null, event.url.protocol === 'https:');
  redirect(303, '/');
};
