/**
 * Keeps API v1 compatible (PRD: the API is frozen as v1 at 1.0). Compares the current OpenAPI document
 * with the snapshot taken at the release (packages/api-spec/frozen/v1.json) and fails on a breaking
 * change: an operation removed, a new required parameter or body property, a body property removed,
 * or a value taken away from an enum. Additions (new operations, optional fields, wider enums) pass.
 *
 *   pnpm check:api            compare
 *   pnpm check:api --freeze   take a new snapshot (only for a new major API version)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CURRENT = path.join(ROOT, 'packages/api-spec/openapi.json');
const FROZEN = path.join(ROOT, 'packages/api-spec/frozen/v1.json');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const current = JSON.parse(readFileSync(CURRENT, 'utf8'));
if (process.argv.includes('--freeze')) {
  mkdirSync(path.dirname(FROZEN), { recursive: true });
  writeFileSync(FROZEN, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Froze ${Object.keys(current.paths).length} paths as API v1`);
  process.exit(0);
}
const frozen = JSON.parse(readFileSync(FROZEN, 'utf8'));

const deref = (doc: any, s: any): any => (s?.$ref ? deref(doc, s.$ref.replace(/^#\//, '').split('/').reduce((o: any, k: string) => o?.[k], doc)) : s);
const bodyOf = (doc: any, op: any) => deref(doc, op?.requestBody?.content?.['application/json']?.schema);
const variants = (s: any): any[] => (s?.anyOf ?? s?.oneOf ?? [s]).filter(Boolean);

const problems: string[] = [];
function compareSchema(where: string, before: any, after: any) {
  before = deref(frozen, before);
  after = deref(current, after);
  if (!before || !after) return;
  if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
    for (const v of before.enum) if (!after.enum.includes(v)) problems.push(`${where}: value ${JSON.stringify(v)} removed`);
  }
  const b = variants(before).find((x) => x.type === 'object' || x.properties);
  const a = variants(after).find((x) => x.type === 'object' || x.properties);
  if (!b || !a) return;
  const bp = b.properties ?? {};
  const ap = a.properties ?? {};
  for (const k of Object.keys(bp)) {
    if (!(k in ap) && a.additionalProperties === false) problems.push(`${where}: property ${k} removed`);
    else if (k in ap) compareSchema(`${where}.${k}`, bp[k], ap[k]);
  }
  for (const k of a.required ?? []) if (!(b.required ?? []).includes(k)) problems.push(`${where}: ${k} became required`);
}

for (const [p, ops] of Object.entries<any>(frozen.paths)) {
  for (const m of METHODS) {
    const before = ops[m];
    if (!before) continue;
    const after = current.paths[p]?.[m];
    const name = `${m.toUpperCase()} ${p}`;
    if (!after) {
      problems.push(`${name}: removed`);
      continue;
    }
    const required = (op: any) => new Set((op.parameters ?? []).filter((x: any) => x.required).map((x: any) => `${x.in}:${x.name}`));
    const was = required(before);
    for (const r of required(after)) if (!was.has(r)) problems.push(`${name}: parameter ${r} became required`);
    if (!before.requestBody?.required && after.requestBody?.required) problems.push(`${name}: a body became required`);
    compareSchema(`${name} body`, bodyOf(frozen, before), bodyOf(current, after));
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} breaking changes to API v1. Make them backwards compatible, or plan API v2.`);
  process.exit(1);
}
console.log(`API v1 is compatible (${Object.keys(frozen.paths).length} frozen paths)`);
