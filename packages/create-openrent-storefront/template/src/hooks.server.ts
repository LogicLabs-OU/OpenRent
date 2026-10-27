import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = ({ event, resolve }) => resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.lang ?? 'en') });
