import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Compares the PRD endpoint catalog (§5.4) and event catalog (§6.1) with what the API serves
 * (`packages/api-spec/openapi.json`) and what the code emits. A gap must be listed in `PLANNED`
 * with the work package that closes it, or under `DIFFERENT` with the reason the API differs on purpose.
 * Entries that are no longer gaps fail too, so both lists stay true. For 1.0, `PLANNED` is empty.
 */
const root = path.resolve(import.meta.dirname, '..');
const prd = readFileSync(path.join(root, '.dev/general/prd.md'), 'utf8');

function section(title: string) {
  const start = prd.indexOf(`### ${title}`);
  const end = prd.indexOf('\n### ', start + 4);
  return prd.slice(start, end);
}

/** Table rows as cells, without the header and divider. */
function rows(text: string) {
  return text.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| ---')).slice(1)
    .map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));
}

const METHOD = /^((?:GET|POST|PUT|PATCH|DELETE)(?:\/(?:GET|POST|PUT|PATCH|DELETE))*)\s+(\S+)/;
const norm = (p: string) => p.replace(/\?.*$/, '').replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '');

/**
 * Expands the catalog's shorthand: a method list applies to following bare paths, and a bare one-segment
 * path (`/disable`) or word (`send_quote`) after an action is another action of the same resource.
 */
function catalog() {
  const out = new Set<string>();
  for (const [resource, ...cells] of rows(section('5.4 Endpoint catalog'))) {
    const prefix = /^Storefront/.test(resource!) ? '/storefront' : /^Portal/.test(resource!) ? '/portal' : /^System/.test(resource!) ? '/system' : '';
    let methods: string[] = [];
    let actions = '';
    for (const cell of cells) {
      for (const [, raw] of cell.matchAll(/`([^`]+)`/g)) {
        const token = raw!.replace(/\\_/g, '_');
        const m = METHOD.exec(token);
        let p: string;
        if (m) {
          methods = m[1]!.split('/');
          p = m[2]!;
        } else if (/^\/?[a-z_]+$/.test(token) && actions) p = `${actions}${token.replace(/^\//, '')}`;
        else if (token.startsWith('/')) p = token;
        else continue;
        if (p.includes('/actions/')) actions = p.slice(0, p.indexOf('/actions/') + 9);
        if (p.endsWith('/actions/')) continue;
        for (const method of methods) out.add(`${method} ${norm(prefix + p)}`);
      }
    }
  }
  return out;
}

function served() {
  const spec = JSON.parse(readFileSync(path.join(root, 'packages/api-spec/openapi.json'), 'utf8'));
  const out = new Set<string>();
  for (const [p, ops] of Object.entries<Record<string, unknown>>(spec.paths)) {
    for (const method of Object.keys(ops)) out.add(`${method.toUpperCase()} ${norm(p.replace(/^\/api\/v1/, ''))}`);
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n);
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) return [];
    if (statSync(f).isDirectory()) return sources(f);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [f] : [];
  });
}

/** Event names the code emits: literals in `emit(` calls, order transitions, CRUD specs and the few built at runtime. */
function emitted() {
  const out = new Set<string>();
  const files = [...sources(path.join(root, 'packages/core/src')), ...sources(path.join(root, 'apps/api/src')), ...sources(path.join(root, 'apps/worker/src'))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) {
      if (/\bemit(TenantEvent)?\(/.test(line)) for (const [, name] of line.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)) out.add(name!);
    }
    for (const [, name] of text.matchAll(/setStatus\(ctx, *o, *[^,]+, *'([a-z_]+)'/g)) out.add(`order.${name}`);
    if (/emit\(ctx, `\$\{spec\.event\}\./.test(text)) continue;
    for (const [, name] of text.matchAll(/^\s+event: '([a-z_]+)',$/gm)) for (const s of ['created', 'updated', 'deleted']) out.add(`${name}.${s}`);
  }
  const orders = readFileSync(path.join(root, 'packages/core/src/orders/index.ts'), 'utf8');
  if (orders.includes("const name = kind === 'extend' ? 'extended' : 'returned_early'")) out.add('order.extended').add('order.returned_early');
  const notifications = readFileSync(path.join(root, 'packages/core/src/notifications/index.ts'), 'utf8');
  if (notifications.includes("emit(ctx, `notification.${status}`")) out.add('notification.sent').add('notification.bounced');
  return out;
}

/** Gaps that a work package of the 1.0 plan closes. */
const PLANNED: Record<string, string> = {
};

/** Places where the API differs from the catalog on purpose, with the reason. */
const DIFFERENT: Record<string, string> = {
  'POST /deliveries': 'A delivery belongs to an order: POST /orders/{id}/deliveries.',
  'POST /webhooks/payments/{}': 'Providers call /webhooks/{provider}/{tenant}, one URL per shop; it is left out of the spec because only providers call it.',
};

describe('PRD coverage', () => {
  const wanted = catalog();
  const have = served();
  const events = emitted();
  const prdEvents = new Set(rows(section('6.1 Event catalog')).flatMap((r) => [...r[1]!.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]!)));

  it('reads the catalogs', () => {
    expect(wanted.size).toBeGreaterThan(150);
    expect(prdEvents.size).toBeGreaterThan(60);
  });

  it('serves every endpoint of PRD §5.4', () => {
    const missing = [...wanted].filter((e) => !have.has(e) && !PLANNED[e] && !DIFFERENT[e]);
    expect(missing).toEqual([]);
  });

  it('emits every event of PRD §6.1', () => {
    const missing = [...prdEvents].filter((e) => !events.has(e) && !PLANNED[e] && !DIFFERENT[e]);
    expect(missing).toEqual([]);
  });

  it('lists only gaps that are still open', () => {
    const closed = [...Object.keys(PLANNED), ...Object.keys(DIFFERENT)].filter((k) => (k.includes(' ') ? have.has(k) : events.has(k)));
    expect(closed).toEqual([]);
  });
});
