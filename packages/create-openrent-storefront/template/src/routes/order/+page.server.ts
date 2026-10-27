import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Back from the payment page: the order's token comes in the query. */
export const load: PageServerLoad = ({ url }) => {
  const token = url.searchParams.get('openrent_token');
  if (!token || !/^[\w-]{16,}$/.test(token)) error(404);
  redirect(303, `/order/${token}`);
};
