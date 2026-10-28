import { redirect } from '@sveltejs/kit';
import { portal, sf, SfError, fail, localPath, localeQuery } from '#lib/server/api.ts';
import { accountToken, setAccount } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!accountToken(event.cookies)) redirect(303, localPath(event, '/account/login'));
  try {
    const account = await sf(event, '/account');
    // The portal's extras (FR-CUS-6): what is owed, business terms, insurance, signatures waiting.
    const me = await portal(event, '/me').catch(() => null);
    // Saved billing details and addresses (ADR 0012), for the account's billing card.
    // Panels plugins add to the account (plugin API 1.9), as cleaned HTML.
    const [profiles, addresses, panels] = await Promise.all([
      sf(event, '/account/billing_profiles').catch(() => ({ data: [] })),
      sf(event, '/account/addresses').catch(() => ({ data: [] })),
      sf(event, `/account/panels${localeQuery(event)}`).catch(() => ({ data: [] })),
    ]);
    return { account, portal: me ? { me } : null, billing: { profiles: profiles.data, addresses: addresses.data }, accountPanels: panels.data as { plugin: string; key: string; title: string; html: string }[] };
  } catch (e) {
    if (e instanceof SfError && e.status === 401) {
      setAccount(event.cookies, null, event.url.protocol === 'https:');
      redirect(303, localPath(event, '/account/login'));
    }
    fail(e);
  }
};
