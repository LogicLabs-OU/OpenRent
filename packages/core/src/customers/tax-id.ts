import type { TaxIdCheck } from '@openrent/plugin-sdk';
import type { Ctx } from '../context.ts';
import { activeTaxProvider } from '../plugins/index.ts';

/**
 * A tax number checked by the shop's tax plugin, when it can check numbers (VIES for EU VAT numbers).
 * Null without such a plugin. A plugin that fails counts as the register being unavailable.
 */
export async function checkTaxId(ctx: Ctx, taxId: string, opts: { fresh?: boolean } = {}): Promise<TaxIdCheck | null> {
  const tax = taxId.trim() ? await activeTaxProvider(ctx, 'checkTaxId') : null;
  if (!tax?.provider.checkTaxId) return null;
  try {
    return await tax.provider.checkTaxId(tax.pctx, taxId.trim(), opts);
  } catch (err) {
    ctx.logger.warn({ err, plugin: tax.pluginId }, 'tax number could not be checked');
    return { status: 'unavailable', country: null, checked_at: ctx.now.toISOString(), reason: 'error' };
  }
}
