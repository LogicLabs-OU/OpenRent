import { defineConfig } from 'drizzle-kit';
import { loadDotEnv } from './src/env.ts';

loadDotEnv();

/**
 * `pnpm db:generate` diffs src/schema.ts against the last snapshot in migrations/meta and writes a
 * timestamped SQL migration. Row-level security, grants and updated_at triggers for new tenant tables
 * are applied by sql/invariants.sql after every migrate, so generated migrations stay plain DDL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  schemaFilter: ['public'],
  tablesFilter: ['!schema_migrations'],
  migrations: { prefix: 'timestamp' },
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '' },
});
