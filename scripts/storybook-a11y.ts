/**
 * Every story of the shared components (packages/ui/stories) checked with axe (PRD §11.2), with the same
 * WCAG 2.1 A/AA rules as the e2e tests. Run after `pnpm --filter @openrent/ui build-storybook`:
 *
 *   pnpm storybook:a11y
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DIR = path.resolve(import.meta.dirname, '../packages/ui/storybook-static');
if (!existsSync(path.join(DIR, 'index.json'))) {
  console.error('Build Storybook first: pnpm --filter @openrent/ui build-storybook');
  process.exit(1);
}
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((req, res) => {
  const file = path.join(DIR, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (!file.startsWith(DIR) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const index = JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const stories = Object.values<any>(index.entries).filter((e) => e.type === 'story');
const browser = await chromium.launch();
const problems: string[] = [];
for (const s of stories) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/iframe.html?id=${s.id}&viewMode=story`, { waitUntil: 'networkidle' });
  // Dialogs and sheets render into a portal outside the root.
  await page.waitForSelector('#storybook-root > *, [role=dialog], [role=alertdialog]', { timeout: 10_000 }).catch(() => errors.push('nothing rendered'));
  // Open overlays finish their entry transitions.
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of r.violations) problems.push(`${s.title} / ${s.name}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  for (const e of errors) problems.push(`${s.title} / ${s.name}: ${e}`);
  await context.close();
}
await browser.close();
server.close();
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problems in ${stories.length} stories`);
  process.exit(1);
}
console.log(`${stories.length} stories pass axe (WCAG 2.1 A and AA)`);
