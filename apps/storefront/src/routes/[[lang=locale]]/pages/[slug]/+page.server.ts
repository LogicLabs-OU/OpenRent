import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { shop } = await event.parent();
  if (event.params.slug === 'terms') return { title: t('page.terms'), body: `${shop.terms.text}\n\n${t('page.terms_version', { version: shop.terms.version })}` };
  error(404, t('error.page_not_found'));
};
