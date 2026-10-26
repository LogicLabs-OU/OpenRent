import { defineParams } from '@sveltejs/kit/params';
import { isLocale } from '@openrent/i18n';

/** `/de/...`: a supported language code. Whether the shop has it on is checked in the root layout. */
export const params = defineParams({
  locale: (param) => (isLocale(param) ? param : undefined),
});
