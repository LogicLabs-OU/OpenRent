import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/** Just enough of OpenRent's OAuth 2.1 and API for the app's own tests (the e2e test uses the real one). */
export async function startOpenRentFake() {
  const clients = new Map<string, { redirect: string }>();
  const codes = new Map<string, { client: string; challenge: string; redirect: string }>();
  const access = new Set<string>();
  const refresh = new Map<string, string>(); // token -> client
  const revoked: string[] = [];
  const settings = { widget_origins: ['https://already.example'] as string[] };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const form = String(req.headers['content-type']).includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
    const json = (s: number, v: unknown) => void res.writeHead(s, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    const issue = (client: string) => {
      const a = `oat_${randomBytes(8).toString('hex')}`;
      const r = `ort_${randomBytes(8).toString('hex')}`;
      access.add(a);
      refresh.set(r, client);
      return { access_token: a, refresh_token: r, expires_in: 3600, token_type: 'Bearer' };
    };
    if (req.method === 'POST' && url.pathname === '/oauth/register') {
      const id = `oac_${randomBytes(6).toString('hex')}`;
      clients.set(id, { redirect: form.redirect_uris[0] });
      return json(201, { client_id: id });
    }
    // Stands in for the person approving on the consent page.
    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const p = url.searchParams;
      const client = clients.get(p.get('client_id') ?? '');
      if (!client || client.redirect !== p.get('redirect_uri') || p.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
      const code = `occ_${randomBytes(8).toString('hex')}`;
      codes.set(code, { client: p.get('client_id')!, challenge: p.get('code_challenge')!, redirect: client.redirect });
      return void res.writeHead(302, { location: `${client.redirect}?code=${code}&state=${encodeURIComponent(p.get('state') ?? '')}` }).end();
    }
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      if (form.grant_type === 'authorization_code') {
        const c = codes.get(form.code);
        codes.delete(form.code);
        if (!c || c.client !== form.client_id || createHash('sha256').update(form.code_verifier ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'bad code' });
        return json(200, issue(c.client));
      }
      const client = refresh.get(form.refresh_token);
      if (!client) return json(400, { error: 'invalid_grant', error_description: 'used' });
      refresh.delete(form.refresh_token);
      return json(200, issue(client));
    }
    if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
      revoked.push(form.token);
      refresh.delete(form.token);
      return json(200, {});
    }
    if (!access.has(String(req.headers.authorization ?? '').replace('Bearer ', ''))) return json(401, { detail: 'no token' });
    if (url.pathname === '/api/v1/tenant') return json(200, { slug: 'demo', name: 'Tallinn Gear Rental', storefront_url: 'https://shop.rent.example' });
    if (url.pathname === '/api/v1/tenant/settings' && req.method === 'GET') return json(200, settings);
    if (url.pathname === '/api/v1/tenant/settings' && req.method === 'PATCH') {
      settings.widget_origins = form.widget_origins;
      return json(200, settings);
    }
    return json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, settings, revoked, close: () => new Promise<void>((r) => server.close(() => r())) };
}
