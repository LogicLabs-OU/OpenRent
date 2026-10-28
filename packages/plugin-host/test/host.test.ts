import { describe, expect, it } from 'vitest';
import { definePlugin, HookVeto } from '@openrent/plugin-sdk';
import { PluginHost } from '../src/index.ts';

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const hctx = { tenantId: 't', actor: { type: 'system', id: null }, logger };

describe('PluginHost', () => {
  it('refuses incompatible plugins', async () => {
    const host = new PluginHost(logger, {});
    const s = await host.register(definePlugin({ id: 'old', name: 'Old', version: '1.0.0', compat: '^2.0.0', setup() {} }));
    expect(s.state).toBe('incompatible');
  });

  it('isolates failing hooks but honours vetoes', async () => {
    const host = new PluginHost(logger, {});
    await host.register(
      definePlugin({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        compat: '^1.0.0',
        setup(api) {
          api.after('orders.transition', () => {
            throw new Error('boom');
          });
          api.before('orders.create', () => {
            throw new HookVeto('no_weekends', 'No weekend orders');
          });
        },
      }),
    );
    await expect(host.runHook('after', 'orders.transition', {}, hctx)).resolves.toBeUndefined();
    expect(host.hookErrors[0]?.error).toBe('boom');
    await expect(host.runHook('before', 'orders.create', {}, hctx)).rejects.toBeInstanceOf(HookVeto);
  });

  it('records setup errors without throwing', async () => {
    const host = new PluginHost(logger, {});
    const s = await host.register(definePlugin({ id: 'bad', name: 'Bad', version: '1.0.0', compat: '^1.0.0', setup() { throw new Error('nope'); } }));
    expect(s.state).toBe('errored');
  });

  it('skips hooks and event handlers of plugins a tenant disabled', async () => {
    const host = new PluginHost(logger, {});
    const seen: string[] = [];
    await host.register(
      definePlugin({
        id: 'audit',
        name: 'Audit',
        version: '1.0.0',
        compat: '^1.0.0',
        setup(api) {
          api.after('orders.transition', (_p, c) => void seen.push(`hook:${c.tenantId}`));
          api.on('order.created', (_e, c) => void seen.push(`event:${c.tenantId}`));
        },
      }),
    );
    await host.useEnablementSource(async () => [{ tenantId: 'off', pluginId: 'audit', enabled: false }]);
    for (const tenantId of ['on', 'off']) {
      const c = { ...hctx, tenantId };
      await host.runHook('after', 'orders.transition', {}, c);
      await host.dispatch({ id: 'e', type: 'order.created', api_version: '1', created_at: '', tenant_id: tenantId, livemode: false, data: { object: {} }, actor: { type: 'system', id: null } }, c);
    }
    expect(seen).toEqual(['hook:on', 'event:on']);
    expect(host.isEnabledFor('off', 'audit')).toBe(false);
  });
});

