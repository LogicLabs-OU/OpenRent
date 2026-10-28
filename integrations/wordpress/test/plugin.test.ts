import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCLI } from '@wp-playground/cli';
import { fileURLToPath } from 'node:url';

/**
 * The plugin in a real WordPress (WordPress Playground: PHP compiled to WebAssembly). OpenRent's answers
 * are stubbed with WordPress's own `pre_http_request` filter, which also records what the plugin sent.
 */
let server: Awaited<ReturnType<typeof runCLI>> & { playground: any };

/** Runs PHP inside WordPress, as the admin; `$stub` answers HTTP calls by path; prints the JSON of $out. */
async function php(body: string, stubs: Record<string, unknown> = {}) {
  const code = `<?php
require '/wordpress/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';
wp_set_current_user(1);
$stubs = json_decode(${JSON.stringify(JSON.stringify(stubs))}, true);
$GLOBALS['sent'] = array();
add_filter('pre_http_request', function ($pre, $args, $url) use ($stubs) {
  $path = parse_url($url, PHP_URL_PATH);
  $GLOBALS['sent'][] = array('method' => $args['method'] ?? 'GET', 'url' => $url, 'body' => $args['body'] ?? null, 'headers' => $args['headers'] ?? array());
  $key = ($args['method'] ?? 'GET') . ' ' . $path;
  if (!array_key_exists($key, $stubs)) return array('response' => array('code' => 404, 'message' => 'Not Found'), 'body' => '{"detail":"no stub for ' . $key . '"}', 'headers' => array(), 'cookies' => array());
  $s = $stubs[$key];
  return array('response' => array('code' => $s['status'] ?? 200, 'message' => 'OK'), 'body' => json_encode($s['body'] ?? $s), 'headers' => array(), 'cookies' => array());
}, 10, 3);
$out = null;
${body}
echo "\\n@@OUT@@" . json_encode(array('out' => $out, 'sent' => $GLOBALS['sent']));`;
  const r = await server.playground.run({ code });
  const text: string = r.text;
  const at = text.lastIndexOf('@@OUT@@');
  if (at < 0) throw new Error(`PHP failed: ${text}\n${r.errors ?? ''}`);
  return JSON.parse(text.slice(at + 7)) as { out: any; sent: { method: string; url: string; body: any; headers: Record<string, string> }[] };
}

const API = 'https://rent.example.test';

describe('OpenRent for WordPress', () => {
  beforeAll(async () => {
    server = (await runCLI({
      command: 'server',
      php: '8.3',
      wp: 'latest',
      login: true,
      quiet: true,
      port: 29400 + Math.floor(Math.random() * 500),
      mount: [{ hostPath: fileURLToPath(new URL('../openrent', import.meta.url)), vfsPath: '/wordpress/wp-content/plugins/openrent' }],
      blueprint: { steps: [{ step: 'activatePlugin', pluginPath: 'openrent/openrent.php' }] },
    } as any)) as any;
  }, 600_000);
  afterAll(async () => {
    await server?.[Symbol.asyncDispose]();
  });

  it('shows nothing to visitors until connected, and tells the admin why', async () => {
    const r = await php(`delete_option('openrent_settings'); $out = array('admin' => do_shortcode('[openrent_product product="bike"]')); wp_set_current_user(0); $out['visitor'] = do_shortcode('[openrent_product product="bike"]');`);
    expect(r.out.admin).toContain('Connect this site to OpenRent');
    expect(r.out.visitor).toBe('');
  });

  it('connects with OpenRent sign-in: registers, sends PKCE, trades the code, and adds the site to the widget sites', async () => {
    const start = await php(`delete_option('openrent_settings'); $out = OpenRent_Connect::start('${API}/'); $out = array('to' => $out, 't' => get_transient('openrent_oauth_1'), 's' => OpenRent_Settings::get());`, {
      'POST /oauth/register': { status: 201, body: { client_id: 'oac_wp_1', token_endpoint_auth_method: 'none' } },
    });
    const reg = start.sent[0]!;
    expect(reg.url).toBe(`${API}/oauth/register`);
    expect(JSON.parse(reg.body)).toMatchObject({ redirect_uris: [expect.stringContaining('/wp-admin/options-general.php?page=openrent')] });
    const to = new URL(start.out.to);
    expect(to.origin + to.pathname).toBe(`${API}/oauth/authorize`);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ response_type: 'code', client_id: 'oac_wp_1', scope: 'tenant:read tenant:write catalog:read', code_challenge_method: 'S256', state: start.out.t.state });
    // The challenge is the S256 of the verifier kept here.
    const { createHash } = await import('node:crypto');
    expect(to.searchParams.get('code_challenge')).toBe(createHash('sha256').update(start.out.t.verifier).digest('base64url'));
    expect(start.out.s.api_url).toBe(API);

    const wrongState = await php(`$out = OpenRent_Connect::finish('occ_x', 'not-it'); $out = is_wp_error($out) ? $out->get_error_code() : $out;`);
    expect(wrongState.out).toBe('openrent_state');
    // The failed try used up the sign-in; start again.
    const again = await php(`$to = OpenRent_Connect::start('${API}'); $out = get_transient('openrent_oauth_1');`);
    const done = await php(`$out = OpenRent_Connect::finish('occ_good', '${again.out.state}'); $out = array('r' => is_wp_error($out) ? $out->get_error_message() : $out, 's' => OpenRent_Settings::get(), 'home' => home_url());`, {
      'POST /oauth/token': { access_token: 'oat_1', refresh_token: 'ort_1', expires_in: 3600, token_type: 'Bearer', scope: 'tenant:read tenant:write catalog:read' },
      'GET /api/v1/tenant': { slug: 'demo', name: 'Tallinn Gear Rental', storefront_url: 'https://shop.example.test' },
      'GET /api/v1/tenant/settings': { widget_origins: ['https://other.example.test'] },
      'PATCH /api/v1/tenant/settings': { widget_origins: [] },
    });
    expect(done.out.r).toBe(true);
    expect(done.out.s).toMatchObject({ mode: 'oauth', access_token: 'oat_1', refresh_token: 'ort_1', shop_slug: 'demo', shop_name: 'Tallinn Gear Rental', storefront_url: 'https://shop.example.test' });
    const token = done.sent.find((x) => x.url.endsWith('/oauth/token'))!;
    expect(Object.fromEntries(Object.entries(token.body))).toMatchObject({ grant_type: 'authorization_code', code: 'occ_good', code_verifier: again.out.verifier, client_id: 'oac_wp_1' });
    const patch = done.sent.find((x) => x.method === 'PATCH')!;
    expect(patch.headers.Authorization).toBe('Bearer oat_1');
    const origin = new URL(done.out.home).origin;
    expect(JSON.parse(patch.body).widget_origins).toEqual(['https://other.example.test', origin]);
  });

  it('writes the widget elements, in shortcodes and blocks, with the widget script', async () => {
    const r = await php(`
      $out = array(
        'product' => do_shortcode('[openrent_product product="City Bike"]'),
        'category' => do_shortcode('[openrent_category category="bikes" limit="500"]'),
        'button' => do_shortcode('[openrent_book_button product="city-bike" label="<b>Book</b>"]'),
        'block' => do_blocks('<!-- wp:openrent/product {"product":"kayak"} /-->'),
        'blocks' => array_values(array_filter(array_keys(WP_Block_Type_Registry::get_instance()->get_all_registered()), fn($n) => str_starts_with($n, 'openrent/'))),
      );
      ob_start(); wp_print_scripts('openrent-widget'); $out['script'] = ob_get_clean();`);
    expect(r.out.product).toBe(`<openrent-product api="${API}" storefront="https://shop.example.test" lang="en" shop="demo" product="city-bike"></openrent-product>`);
    expect(r.out.category).toContain('category="bikes" limit="48"');
    expect(r.out.button).toBe('<openrent-book-button storefront="https://shop.example.test" product="city-bike" label="Book" lang="en"></openrent-book-button>');
    expect(r.out.block).toContain('<openrent-product ');
    expect(r.out.block).toContain('product="kayak"');
    expect(r.out.blocks.sort()).toEqual(['openrent/book-button', 'openrent/category', 'openrent/product']);
    expect(r.out.script).toContain(`data-openrent-api="${API}" src="${API}/widget/openrent-widget.js`);
  });

  it('renews the access token with the refresh token, and forgets a connection OpenRent ended', async () => {
    const renewed = await php(`OpenRent_Settings::update(array('expires_at' => time() - 10)); $out = array('t' => OpenRent_Client::access_token(), 's' => OpenRent_Settings::get());`, {
      'POST /oauth/token': { access_token: 'oat_2', refresh_token: 'ort_2', expires_in: 3600, token_type: 'Bearer' },
    });
    expect(renewed.out.t).toBe('oat_2');
    expect(renewed.out.s).toMatchObject({ access_token: 'oat_2', refresh_token: 'ort_2' });
    expect(renewed.sent[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ort_1' });

    const ended = await php(`OpenRent_Settings::update(array('expires_at' => time() - 10)); $t = OpenRent_Client::access_token(); $out = array('code' => is_wp_error($t) ? $t->get_error_code() : $t, 's' => OpenRent_Settings::get());`, {
      'POST /oauth/token': { status: 400, body: { error: 'invalid_grant', error_description: 'the refresh token was already used or revoked' } },
    });
    expect(ended.out.code).toBe('openrent_not_connected');
    expect(ended.out.s.refresh_token).toBe('');
  });

  it('lists the shop’s products for the block editor, for people who edit posts only', async () => {
    const r = await php(`
      OpenRent_Settings::update(array('mode' => 'oauth', 'shop_slug' => 'demo', 'refresh_token' => 'ort_3', 'access_token' => 'oat_3', 'expires_at' => time() + 3600));
      $res = rest_do_request(new WP_REST_Request('GET', '/openrent/v1/products'));
      wp_set_current_user(0);
      $anon = rest_do_request(new WP_REST_Request('GET', '/openrent/v1/products'));
      $out = array('data' => $res->get_data(), 'anon' => $anon->get_status());`, {
      'GET /api/v1/storefront/catalog/products': { data: [{ slug: 'kayak', name: 'Kayak' }, { slug: 'city-bike', name: 'City bike' }] },
    });
    expect(r.out.data).toEqual([{ slug: 'city-bike', name: 'City bike' }, { slug: 'kayak', name: 'Kayak' }]);
    expect(r.out.anon).toBe(401);
    expect(r.sent[0]!.headers['X-Tenant-Slug']).toBe('demo');
  });

  it('connects with a publishable key instead, and refuses what is not one', async () => {
    const bad = await php(`$r = OpenRent_Connect::use_key('${API}', 'sk_live_secret', ''); $out = $r->get_error_code();`);
    expect(bad.out).toBe('openrent_bad_key');
    const http = await php(`$r = OpenRent_Connect::use_key('http://rent.example.test', 'pk_live_abcdefghijklmnop', ''); $out = $r->get_error_code();`);
    expect(http.out).toBe('openrent_bad_url');
    const ok = await php(`OpenRent_Settings::disconnect(); $r = OpenRent_Connect::use_key('${API}', 'pk_live_abcdefghijklmnop', 'https://shop.example.test'); $out = array('r' => $r, 's' => OpenRent_Settings::get(), 'p' => do_shortcode('[openrent_product product="kayak"]'));`, {
      'GET /api/v1/storefront/settings': { tenant: { slug: 'demo', name: 'Tallinn Gear Rental' }, categories: [] },
    });
    expect(ok.out.r).toBe(true);
    expect(ok.out.s).toMatchObject({ mode: 'key', shop_name: 'Tallinn Gear Rental' });
    expect(ok.out.p).toContain('pk="pk_live_abcdefghijklmnop"');
    expect(ok.sent[0]!.headers.Authorization).toBe('Bearer pk_live_abcdefghijklmnop');
  });

  it('revokes the tokens on disconnect, speaks the site’s language, and leaves nothing when removed', async () => {
    const off = await php(`OpenRent_Settings::update(array('mode' => 'oauth', 'refresh_token' => 'ort_9', 'client_id' => 'oac_wp_1')); OpenRent_Connect::disconnect(); $out = OpenRent_Settings::get();`, { 'POST /oauth/revoke': {} });
    expect(off.sent[0]).toMatchObject({ url: `${API}/oauth/revoke`, body: { token: 'ort_9', client_id: 'oac_wp_1' } });
    expect(off.out).toMatchObject({ mode: '', refresh_token: '', api_url: API });
    // (WordPress switches only to languages it has installed; the plugin's own file is loaded as for a German site.)
    const de = await php(`add_filter('determine_locale', fn() => 'de_DE'); add_filter('locale', fn() => 'de_DE'); unload_textdomain('openrent'); load_plugin_textdomain('openrent', false, 'openrent/languages'); $out = __('Connect to OpenRent', 'openrent');`);
    expect(de.out).toBe('Mit OpenRent verbinden');
    const gone = await php(`define('WP_UNINSTALL_PLUGIN', 'openrent/openrent.php'); include WP_PLUGIN_DIR . '/openrent/uninstall.php'; $out = get_option('openrent_settings', 'none');`);
    expect(gone.out).toBe('none');
  });
});
