import { api } from '../api.ts';

/**
 * The shop's storefront languages, default first. Loaded once and shared by the translation editors
 * (products, categories, themes, emails).
 */
class ShopLocales {
  list = $state<string[]>([]);
  loaded = $state(false);
  private pending: Promise<void> | null = null;

  get default() {
    return this.list[0] ?? 'en';
  }
  /** Languages that need translations: every enabled one except the default. */
  get others() {
    return this.list.slice(1);
  }

  load(force = false) {
    if (this.pending && !force) return this.pending;
    this.pending = api.get('/tenant/settings').then((s) => {
      const def: string = s.storefront?.default_locale ?? 'en';
      this.list = [def, ...((s.storefront?.locales ?? []) as string[]).filter((l) => l !== def)];
      this.loaded = true;
    });
    return this.pending;
  }
}

export const shopLocales = new ShopLocales();
