import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, databaseForTests, shopForTests, type TestApp } from './harness.ts';

const dbinfo = await databaseForTests();
const suite = dbinfo ? describe : describe.skip;

/** The embeddable widget dresses like the live theme (FR-THM-10): its widget CSS, filled with the shop's settings. */
suite('widget theming', () => {
  let t: TestApp;
  let admin: Client;
  const shop = () => new Client(t.app, { 'x-tenant-slug': 'test-rentals' });
  const widgetCss = async () => (await shop().get('/api/v1/storefront/settings')).body.widget.css as string;

  beforeAll(async () => {
    ({ t, admin } = await shopForTests(dbinfo!));
  }, 120_000);

  afterAll(async () => {
    await t?.close();
    await dbinfo?.stop();
  });

  it('fills the live theme’s widget CSS with its settings and the brand colour', async () => {
    // The default theme: no accent and no brand colour yet, so only the radius is set.
    const first = await widgetCss();
    expect(first).toContain('--radius: 10px;');
    expect(first).not.toContain('--primary:');
    expect((await admin.patch('/api/v1/themes/default/settings', { settings: { accent: '#ffcc00', radius: 4 } })).status).toBe(200);
    const css = await widgetCss();
    expect(css).toContain('--primary: #ffcc00;');
    expect(css).toContain('--primary-foreground: #0a0a0a;');
    expect(css).toContain('--radius: 4px;');
  });

  it('follows the theme that goes live', async () => {
    expect((await admin.post('/api/v1/themes/nightfall/actions/publish')).status).toBe(200);
    const css = await widgetCss();
    expect(css).toContain('--card: #18181b;');
    expect(css).toContain('--primary: #5351f3;');
    expect((await admin.post('/api/v1/themes/default/actions/publish')).status).toBe(200);
  });
});
