import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { exchangeInstallCode, isShopDomain, storefrontOrigins, verifyQuery, verifyWebhook, writeConfig, type ShopifyOptions } from './shopify.ts';
import * as openrent from './openrent.ts';
import { lang, t } from './i18n.ts';
import type { ShopRecord, Store } from './store.ts';

export { memoryStore, fileStore } from './store.ts';

/**
 * The OpenRent app for Shopify (FR-SF-7). Shopify installs it with OAuth; the merchant opens its page in the
 * Shopify admin, connects the shop to their OpenRent (OpenRent sign-in, OAuth 2.1 with PKCE), and the theme
 * blocks then show OpenRent's booking widget. The app keeps each shop's tokens and nothing about customers.
 */
export interface AppConfig extends ShopifyOptions {
  /** Where this app answers, such as https://shopify.openrent.example. */
  appUrl: string;
  /** Shopify access scopes; the blocks need none. */
  scopes: string;
  store: Store;
}

const TEN_MINUTES = 10 * 60_000;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export function createApp(cfg: AppConfig) {
  const admin = (shop: string) => `${cfg.base(shop)}/admin/apps/${cfg.apiKey}`;
  const save = (r: ShopRecord) => cfg.store.set(r);

  /** Forms on the app's page carry the shop, signed for an hour, so a post cannot name another shop. */
  const sign = (shop: string, until: number) => createHmac('sha256', cfg.apiSecret).update(`${shop}.${until}`).digest('base64url');
  const signed = (shop: string, until: string, sig: string) => {
    if (!isShopDomain(shop) || !(Number(until) > Date.now())) return false;
    const a = Buffer.from(sign(shop, Number(until)));
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(body);
  }
  const redirect = (res: ServerResponse, to: string, headers: Record<string, string> = {}) => {
    res.writeHead(302, { location: to, 'cache-control': 'no-store', ...headers });
    res.end();
  };

  function page(res: ServerResponse, shop: string, record: ShopRecord | null, l: ReturnType<typeof lang>, notice: { kind: 'ok' | 'error'; text: string } | null) {
    const until = Date.now() + 3_600_000;
    const hidden = `<input type="hidden" name="shop" value="${esc(shop)}"><input type="hidden" name="until" value="${until}"><input type="hidden" name="sig" value="${esc(sign(shop, until))}"><input type="hidden" name="locale" value="${l}">`;
    const o = record?.openrent;
    const body = o?.refreshToken
      ? `<p id="status">${esc(t(l, 'connected', { shop: o.tenantName ?? '', url: o.apiUrl }))}</p><p>${esc(t(l, 'blocks'))}</p>
         <form method="post" action="${esc(cfg.appUrl)}/openrent/disconnect" target="_top">${hidden}<button type="submit">${esc(t(l, 'disconnect'))}</button></form>`
      : `<p>${esc(t(l, 'intro'))}</p>
         <form method="post" action="${esc(cfg.appUrl)}/openrent/connect" target="_top">${hidden}
           <label for="api_url">${esc(t(l, 'address'))}</label>
           <input id="api_url" name="api_url" type="url" required placeholder="https://rent.example.com" value="${esc(o?.apiUrl ?? '')}" aria-describedby="api_url_hint">
           <p id="api_url_hint" class="hint">${esc(t(l, 'address_hint'))}</p>
           <button type="submit">${esc(t(l, 'connect'))}</button></form>`;
    send(
      res,
      200,
      `<!doctype html><html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="shopify-api-key" content="${esc(cfg.apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script><title>${esc(t(l, 'title'))}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:24px;max-width:640px;color:#303030}label{display:block;font-weight:600;margin:16px 0 4px}input[type=url]{width:100%;padding:8px;border:1px solid #8a8a8a;border-radius:8px;font:inherit}.hint{color:#616161;font-size:13px}button{margin-top:16px;padding:8px 16px;border-radius:8px;border:0;background:#303030;color:#fff;font:inherit;cursor:pointer}.notice{padding:12px;border-radius:8px}.ok{background:#e3f1df}.error{background:#fbeae5}</style></head>
<body><h1>${esc(t(l, 'title'))}</h1>${notice ? `<div role="status" class="notice ${notice.kind}">${esc(notice.text)}</div>` : ''}${body}</body></html>`,
      { 'content-security-policy': `frame-ancestors https://${shop} https://admin.shopify.com;` },
    );
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', cfg.appUrl);
    const q = url.searchParams;
    try {
      // Shopify opens the app (and starts an install) with a signed query.
      if (req.method === 'GET' && url.pathname === '/') {
        const shop = q.get('shop');
        if (!isShopDomain(shop) || !verifyQuery(q, cfg.apiSecret)) return send(res, 401, 'Open the app from the Shopify admin.');
        const record = await cfg.store.get(shop);
        if (!record?.shopifyToken) return redirect(res, `${cfg.appUrl}/auth?shop=${encodeURIComponent(shop)}`);
        const l = lang(q.get('locale'));
        const n = q.get('notice');
        const notice = n === 'done' || n === 'gone' ? { kind: 'ok' as const, text: t(l, n) } : n === 'declined' ? { kind: 'error' as const, text: t(l, 'declined') } : null;
        return page(res, shop, record, l, notice);
      }

      if (req.method === 'GET' && url.pathname === '/auth') {
        const shop = q.get('shop');
        if (!isShopDomain(shop)) return send(res, 400, 'Unknown shop');
        const state = randomBytes(16).toString('base64url');
        const record = (await cfg.store.get(shop)) ?? { shop };
        await save({ ...record, installState: { state, until: Date.now() + TEN_MINUTES } });
        const to = new URLSearchParams({ client_id: cfg.apiKey, scope: cfg.scopes, redirect_uri: `${cfg.appUrl}/auth/callback`, state });
        return redirect(res, `${cfg.base(shop)}/admin/oauth/authorize?${to}`);
      }

      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const shop = q.get('shop');
        if (!isShopDomain(shop) || !verifyQuery(q, cfg.apiSecret)) return send(res, 401, 'The install could not be verified.');
        const record = await cfg.store.get(shop);
        if (!record?.installState || record.installState.state !== q.get('state') || record.installState.until < Date.now()) return send(res, 401, 'The install could not be verified.');
        const tok = await exchangeInstallCode(cfg, shop, q.get('code') ?? '');
        await save({ ...record, installState: undefined, shopifyToken: tok.access_token, scope: tok.scope });
        return redirect(res, admin(shop));
      }

      if (req.method === 'POST' && (url.pathname === '/openrent/connect' || url.pathname === '/openrent/disconnect')) {
        const form = new URLSearchParams((await readBody(req)).toString('utf8'));
        const shop = form.get('shop') ?? '';
        const l = lang(form.get('locale'));
        if (!signed(shop, form.get('until') ?? '', form.get('sig') ?? '')) return send(res, 401, esc(t(l, 'expired')));
        const record = await cfg.store.get(shop);
        if (!record?.shopifyToken) return send(res, 401, esc(t(l, 'expired')));
        const back = (notice: string) => redirect(res, `${admin(shop)}?notice=${notice}&locale=${l}`);

        if (url.pathname === '/openrent/disconnect') {
          if (record.openrent?.refreshToken) await openrent.revoke(record.openrent.apiUrl, record.openrent.clientId, record.openrent.refreshToken);
          await writeConfig(cfg, shop, record.shopifyToken, null).catch(() => undefined);
          await save({ ...record, openrent: record.openrent ? { apiUrl: record.openrent.apiUrl, clientId: record.openrent.clientId } : undefined });
          return back('gone');
        }

        const apiUrl = openrent.cleanApiUrl(form.get('api_url'));
        if (!apiUrl) return page(res, shop, record, l, { kind: 'error', text: t(l, 'bad_address') });
        const redirectUri = `${cfg.appUrl}/openrent/callback`;
        let clientId = record.openrent?.apiUrl === apiUrl ? record.openrent.clientId : '';
        try {
          if (!clientId) clientId = await openrent.register(apiUrl, `${shop.replace(/\.myshopify\.com$/, '')} (Shopify)`, redirectUri, `https://${shop}`);
        } catch (err) {
          return page(res, shop, record, l, { kind: 'error', text: t(l, 'failed', { message: (err as Error).message }) });
        }
        const p = openrent.pkce();
        const state = randomBytes(16).toString('base64url');
        await save({ ...record, openrent: { ...(record.openrent?.apiUrl === apiUrl ? record.openrent : {}), apiUrl, clientId }, pending: { state, verifier: p.verifier, until: Date.now() + TEN_MINUTES, locale: l } });
        return redirect(res, openrent.authorizeUrl(apiUrl, clientId, redirectUri, state, p.challenge));
      }

      // Back from OpenRent: the state names the shop.
      if (req.method === 'GET' && url.pathname === '/openrent/callback') {
        const state = q.get('state') ?? '';
        const record = state ? await cfg.store.byState(state) : null;
        if (!record?.pending || record.pending.until < Date.now() || !record.openrent || !record.shopifyToken) return send(res, 401, 'This sign-in was not started here, or took too long.');
        const { verifier, locale } = record.pending;
        const back = (notice: string) => redirect(res, `${admin(record.shop)}?notice=${notice}&locale=${locale ?? 'en'}`);
        record.pending = undefined;
        await save(record);
        if (q.get('error')) return back('declined');
        const o = record.openrent;
        const tok = await openrent.token(o.apiUrl, { grant_type: 'authorization_code', code: q.get('code') ?? '', code_verifier: verifier, redirect_uri: `${cfg.appUrl}/openrent/callback`, client_id: o.clientId });
        record.openrent = { ...o, accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000 };
        await save(record);
        const tenant = await openrent.api(record, save, 'GET', '/api/v1/tenant');
        record.openrent = { ...record.openrent!, tenantName: tenant.name, tenantSlug: tenant.slug, storefrontUrl: tenant.storefront_url ?? '' };
        await save(record);
        // The shop's storefront may embed the widget and bring paying customers back.
        const settings = await openrent.api(record, save, 'GET', '/api/v1/tenant/settings');
        const origins: string[] = Array.isArray(settings.widget_origins) ? settings.widget_origins : [];
        const add = (await storefrontOrigins(cfg, record.shop, record.shopifyToken)).filter((x) => !origins.includes(x));
        if (add.length) await openrent.api(record, save, 'PATCH', '/api/v1/tenant/settings', { widget_origins: [...origins, ...add] });
        await writeConfig(cfg, record.shop, record.shopifyToken, { api_url: o.apiUrl, shop: tenant.slug, storefront_url: tenant.storefront_url ?? '' });
        return back('done');
      }

      // Webhooks: uninstalls, and Shopify's privacy requests (the app keeps no customer data).
      if (req.method === 'POST' && url.pathname === '/webhooks') {
        const raw = await readBody(req);
        if (!verifyWebhook(raw, req.headers['x-shopify-hmac-sha256'] as string | undefined, cfg.apiSecret)) return send(res, 401, 'Invalid signature');
        const topic = String(req.headers['x-shopify-topic'] ?? '');
        const shop = String(req.headers['x-shopify-shop-domain'] ?? '');
        if ((topic === 'app/uninstalled' || topic === 'shop/redact') && isShopDomain(shop)) {
          const record = await cfg.store.get(shop);
          if (record?.openrent?.refreshToken) await openrent.revoke(record.openrent.apiUrl, record.openrent.clientId, record.openrent.refreshToken);
          await cfg.store.delete(shop);
        }
        return send(res, 200, '');
      }

      return send(res, 404, 'Not found');
    } catch (err) {
      return send(res, 502, esc((err as Error).message));
    }
  };
}
