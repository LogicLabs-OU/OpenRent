import type { LayoutServerLoad } from './$types';

/** Account pages are personal: never cached and kept out of search engines. */
export const load: LayoutServerLoad = async ({ setHeaders }) => {
  setHeaders({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
  return {};
};
