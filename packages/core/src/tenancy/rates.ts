import type { Ctx } from '../context.ts';
import { AppError } from '../errors.ts';
import { t } from '../i18n/index.ts';
import { must } from '../sql.ts';
import { pluginConfig } from '../plugins/index.ts';
import { resolveSettings } from './settings.ts';
import { updateSettings } from './index.ts';

/**
 * Exchange rates for prices shown in other currencies (FR-I18N-7). With a rates plugin as the source,
 * the worker brings them up to date each day; staff can also ask for it at once.
 */
export async function refreshRates(ctx: Ctx, opts: { strict?: boolean } = {}) {
  const tenant = await must<{ currency: string; settings: unknown }>(ctx, `SELECT currency, settings FROM tenants WHERE id = $1`, [ctx.tenantId], 'tenant');
  const s = resolveSettings(tenant.settings);
  const dc = s.display_currencies;
  const base = tenant.currency.trim();
  const wanted = dc.currencies.filter((c) => c !== base);
  if (dc.source === 'manual' || !wanted.length) {
    if (opts.strict) throw new AppError('rates_manual', 409, t('settings.rates_manual'));
    return null;
  }
  const provider = ctx.plugins.ratesProviders().find((p) => (ctx.plugins.pluginIdOf(p.id) ?? p.id) === dc.source);
  const { enabled, config } = await pluginConfig(ctx, dc.source);
  const pctx = { tenantId: ctx.tenantId, config, logger: ctx.logger };
  if (!provider || !enabled || !provider.isConfigured(pctx)) {
    if (opts.strict) throw new AppError('rates_unavailable', 409, t('settings.rates_unavailable'));
    return null;
  }
  const r = await provider.rates(pctx, base, wanted);
  const rates = Object.fromEntries(Object.entries(r.rates).filter(([c, v]) => wanted.includes(c) && typeof v === 'number' && v > 0 && v <= 1_000_000).map(([c, v]) => [c, Math.round(v * 1e6) / 1e6]));
  return updateSettings(ctx, { display_currencies: { rates: { ...dc.rates, ...rates }, updated_at: r.date } });
}
