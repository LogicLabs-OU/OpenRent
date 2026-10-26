import { redirect } from '@sveltejs/kit';
import { sf, SfError, fail, localPath } from '#lib/server/api.ts';
import { accountToken, setAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!accountToken(event.cookies)) redirect(303, localPath(event, '/account/login'));
  try {
    return { account: await sf(event, '/account') };
  } catch (e) {
    if (e instanceof SfError && e.status === 401) {
      setAccount(event.cookies, null, event.url.protocol === 'https:');
      redirect(303, localPath(event, '/account/login'));
    }
    fail(e);
  }
};
