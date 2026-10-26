import { existsSync } from 'node:fs';
import path from 'node:path';

/** Loads the nearest .env walking up from cwd (Node's built-in loader; no dotenv dependency). */
export function loadDotEnv(start = process.cwd()): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, '.env');
    if (existsSync(f)) {
      process.loadEnvFile(f);
      return f;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function requireDatabaseUrl(kind: 'app' | 'migration' = 'app'): string {
  const url = kind === 'migration' ? process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill in your PostgreSQL 16 connection string.');
    process.exit(1);
  }
  return url;
}
