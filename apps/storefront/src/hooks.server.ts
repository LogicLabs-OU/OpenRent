import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { setPreview } from '#lib/server/session.ts';
import { isLocale } from '@openrent/i18n';
import { withSources } from '#lib/server/csp.ts';
import { isPrivatePath } from '#lib/meta.ts';
import { PREVIEW_COOKIE } from '#lib/server/api.ts';

/** `?preview_theme=<token>` from the admin starts a theme preview, then the clean URL is loaded. */
export const handle: Handle = async ({ event, resolve }) => {
  // The theme runtime names the page's language on its `_or` calls; pages take it from the URL.
  const header = event.request.headers.get('x-or-locale');
  event.locals.locale = isLocale(header) ? header : null;
  const token = event.url.searchParams.get('preview_theme');
  if (token) {
    setPreview(event.cookies, token, event.url.protocol === 'https:');
    const clean = new URL(event.url);
    clean.searchParams.delete('preview_theme');
    redirect(303, `${clean.pathname}${clean.search}`);
  }
  const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.htmlLang ?? 'en') });
  const policy = response.headers.get('content-security-policy');
  if (policy && event.locals.csp) response.headers.set('content-security-policy', withSources(policy, event.locals.csp));
  // Carts, private links (with their PDFs and photos), the account and theme previews stay out of search engines.
  if ((isPrivatePath(event.url.pathname) || event.cookies.get(PREVIEW_COOKIE)) && !response.headers.has('x-robots-tag')) response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
};
