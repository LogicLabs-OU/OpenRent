declare global {
	namespace App {
		interface Error {
			message: string;
		}
		interface Locals {
			/** Storefront language of this request: the URL prefix, or the runtime's header on `_or` calls. Null = the shop default. */
			locale: string | null;
			/** The language the page renders in, for `<html lang>` (set by the root layout). */
			htmlLang?: string;
			/** Extra CSP sources of this shop's payment provider, added to the page's policy in hooks. */
			csp?: Partial<Record<'script' | 'frame' | 'connect' | 'img' | 'style', string[]>>;
		}
	}
}
export {};
