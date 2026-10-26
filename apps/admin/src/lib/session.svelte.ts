import { api } from './api.ts';
import { browserLocale, devLocale, setLocale } from './i18n/index.svelte.ts';

export interface Me {
  user: { id: string; email: string; name: string; locale: string; totp_enabled: boolean; has_password?: boolean };
  tenant: { id: string; slug: string; name: string; currency: string; timezone: string; locale: string; branding: Record<string, any> } | null;
  memberships: { tenant_id: string; tenant_name: string; role: string }[];
  role: string | null;
  permissions: string[];
}

class Session {
  me = $state<Me | null>(null);
  locations = $state<any[]>([]);
  /** The location the header switcher picked: lists, the dashboard and reports show only it. Empty means all. */
  locationId = $state('');
  loaded = $state(false);

  async load() {
    try {
      this.me = await api.get<Me>('/auth/me');
      await setLocale(devLocale() ?? this.me?.user.locale);
      if (this.me?.tenant) {
        // A custom role may not see locations; the admin still works, with the shop's time zone.
        this.locations = this.can('locations:read') ? ((await api.get('/locations').catch(() => ({ data: [] }))).data as any[]) : [];
        this.locationId = this.remembered();
      }
    } catch {
      this.me = null;
      // Signed out (login page): follow the browser.
      await setLocale(devLocale() ?? browserLocale());
    } finally {
      this.loaded = true;
    }
  }

  /** Saves the signed-in user's admin language and switches to it. */
  async setLanguage(locale: string) {
    await api.patch('/auth/me', { locale });
    if (this.me) this.me = { ...this.me, user: { ...this.me.user, locale } };
    await setLocale(locale);
  }

  private get storageKey() {
    return `or_location:${this.me?.tenant?.id ?? ''}`;
  }
  /** The location picked last time in this browser, if it still exists. */
  private remembered() {
    let id = '';
    try {
      id = localStorage.getItem(this.storageKey) ?? '';
    } catch {
      // Storage can be blocked; the switcher then starts at all locations.
    }
    return !this.singleLocation && this.locations.some((l) => l.id === id) ? id : '';
  }
  setLocation(id: string) {
    this.locationId = id;
    try {
      if (id) localStorage.setItem(this.storageKey, id);
      else localStorage.removeItem(this.storageKey);
    } catch {
      // Not remembered; the choice still holds until the page reloads.
    }
  }
  /** The picked location, or null for all locations. */
  get location() {
    return this.locations.find((l) => l.id === this.locationId) ?? null;
  }

  can(perm: string) {
    const p = this.me?.permissions ?? [];
    const [res] = perm.split(':');
    return p.includes('*') || p.includes(perm) || p.includes(`${res}:*`) || (perm === 'orders:fulfil' && p.includes('orders:write'));
  }

  get tz() {
    return this.location?.timezone ?? this.locations[0]?.timezone ?? this.me?.tenant?.timezone ?? 'UTC';
  }
  get currency() {
    return this.me?.tenant?.currency ?? 'EUR';
  }
  get singleLocation() {
    return this.locations.length <= 1;
  }
}

export const session = new Session();
