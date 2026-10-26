import { auth as coreAuth, createSecretBox, tenancy, consoleLogger, type Ctx } from '@openrent/core';
import { emptyRuntime } from '@openrent/plugin-sdk';
import { createDatabase, probeAppRole, withSystem, withTenant } from './client.ts';
import { loadDotEnv, requireDatabaseUrl } from './env.ts';
import { migrate } from './migrate.ts';
import { seedDemoCatalog } from './demo.ts';

loadDotEnv();
const url = requireDatabaseUrl();
await migrate(process.env.DATABASE_MIGRATION_URL || url, { log: () => undefined });
const db = createDatabase({ connectionString: url, max: 2 });
await probeAppRole(db);
const secrets = createSecretBox(process.env.OPENRENT_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64'));
const publicUrl = (process.env.OPENRENT_PUBLIC_URL || 'http://localhost:7070').replace(/\/$/, '');

const done = await withSystem(db, (c) => tenancy.isSetupComplete(c));
if (done) {
  console.log('A tenant already exists; nothing to seed. Reset the database to reseed.');
  await db.close();
  process.exit(0);
}

const email = process.env.SEED_OWNER_EMAIL || 'owner@example.com';
const password = process.env.SEED_OWNER_PASSWORD || 'openrent';
const setup = await withSystem(db, (c) =>
  tenancy.runSetup(
    c,
    {
      owner: { email, password, name: 'Demo Owner' },
      tenant: { name: 'Tallinn Gear Rental', slug: process.env.TENANT_SLUG || 'demo', currency: 'EUR', timezone: 'Europe/Tallinn', locale: 'en' },
      location: { name: 'Old Town shop', address: { line1: 'Viru 1', city: 'Tallinn', postal_code: '10140', country: 'EE' } },
      tax: { name: 'VAT', rate_bp: 2400 },
    },
    { livemode: false },
  ),
);

const secret = await withTenant(db, setup.tenantId, async (c) => {
  const ctx: Ctx = {
    db: c,
    tenantId: setup.tenantId,
    actor: { type: 'system', id: null },
    now: new Date(),
    plugins: emptyRuntime,
    secrets,
    config: { publicUrl, adminUrl: process.env.ADMIN_URL || `${publicUrl}/admin`, storefrontUrl: process.env.STOREFRONT_URL || 'http://localhost:7072', livemode: false },
    logger: consoleLogger,
  };
  await c.query(`UPDATE tenants SET legal_name = 'Tallinn Gear Rental OÜ', address = $2, tax_ids = $3, branding = $4 WHERE id = $1`, [
    setup.tenantId,
    JSON.stringify({ line1: 'Viru 1', city: 'Tallinn', postal_code: '10140', country: 'EE' }),
    JSON.stringify([{ type: 'VAT', value: 'EE100000000' }]),
    JSON.stringify({ primary_color: '#0891b2' }),
  ]);
  const stats = await seedDemoCatalog(ctx);
  const key = await tenancy.createApiKey(ctx, { name: 'Seed secret key', kind: 'secret', scopes: ['*'] });
  return { stats, key: key.key };
});

console.log(`
Seeded tenant "${setup.slug}" (${setup.tenantId})
  ${secret.stats.products} products, ${secret.stats.customers} customers, ${secret.stats.orders} orders

  Owner login:      ${email} / ${password}
  Secret API key:   ${secret.key}
  Publishable key:  ${setup.publishableKey}
`);
void coreAuth;
await db.close();
