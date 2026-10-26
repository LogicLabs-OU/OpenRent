import type { AccountLoginData } from '@openrent/theme-sdk';
import type { PageServerLoad } from './$types';

/** Shows a button instead of signing in on GET, so mail scanners that open links cannot use them up. */
export const load: PageServerLoad = async ({ url }) =>
  ({ state: 'verify', token: url.searchParams.get('token') ?? '' }) satisfies AccountLoginData;
