/** Emits the OpenAPI 3.1 document to packages/api-spec/openapi.json without a database connection. */
import { loadThemes } from '../src/themes.ts';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSecretBox } from '@openrent/core';
import { createDatabase } from '@openrent/db';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { createPluginHost } from '../src/plugins.ts';
import { readVersion } from '../src/bootstrap.ts';

const config = loadConfig({
  DATABASE_URL: 'postgres://spec@127.0.0.1:1/spec',
  OPENRENT_PUBLIC_URL: 'http://localhost:7070',
  OPENRENT_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  OPENRENT_SESSION_SECRET: 's'.repeat(40),
  AUTO_MIGRATE: 'false',
});
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const deps = { config, db: createDatabase({ connectionString: config.databaseUrl, max: 1 }), plugins: await createPluginHost(quiet), themes: loadThemes(quiet), secrets: createSecretBox(config.encryptionKey), version: readVersion() };
const app = await buildApp(deps, { logger: false });
await app.ready();
const spec = app.swagger() as any;
spec.servers = [{ url: 'http://localhost:7070', description: 'Local development' }];
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/api-spec/openapi.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote ${out}: ${Object.keys(spec.paths).length} paths`);
await app.close();
await deps.db.close();
