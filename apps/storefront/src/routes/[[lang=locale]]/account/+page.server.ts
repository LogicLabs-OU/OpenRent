import { redirect } from '@sveltejs/kit';
import { portal, sf, SfError, fail, localPath } from '#lib/server/api.ts';
import { accountToken, setAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!accountToken(event.cookies)) redirect(303, localPath(event, '/account/login'));
  try {
    const account = await sf(event, '/account');
    // The portal's extras (FR-CUS-6): what is owed, business terms, insurance, signatures waiting.
    const me = await portal(event, '/me').catch(() => null);
    // Saved billing details and addresses (ADR 0012), for the account's billing card.
    const [profiles, addresses] = await Promise.all([sf(event, '/account/billing_profiles').catch(() => ({ data: [] })), sf(event, '/account/addresses').catch(() => ({ data: [] }))]);
    return { account, portal: me ? { me } : null, billing: { profiles: profiles.data, addresses: addresses.data } };
  } catch (e) {
    if (e instanceof SfError && e.status === 401) {
      setAccount(event.cookies, null, event.url.protocol === 'https:');
      redirect(303, localPath(event, '/account/login'));
    }
    fail(e);
  }
};
