import { error } from '@sveltejs/kit';
import { OpenRentError } from '@openrent/sdk';
import { shop } from '#lib/server/openrent.ts';
import type { PageServerLoad } from './$types';

/** The confirmation: the order's token is in the link, so only the customer has it. */
export const load: PageServerLoad = async (event) => {
  const { shop: s } = await event.parent();
  try {
    return { order: await shop(event, s.lang).order(event.params.token, event.params.token) };
  } catch (e) {
    if (e instanceof OpenRentError && (e.status === 404 || e.status === 401)) error(404, e.message);
    throw e;
  }
};
