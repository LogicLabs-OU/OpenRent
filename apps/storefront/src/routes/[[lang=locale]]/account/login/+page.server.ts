import { localPath } from '#lib/server/api.ts';
import { redirect } from '@sveltejs/kit';
import type { AccountLoginData } from '@openrent/theme-sdk';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop } = await event.parent();
  if (shop.customer) redirect(303, localPath(event, '/account'));
  return { state: 'form' } satisfies AccountLoginData;
};
