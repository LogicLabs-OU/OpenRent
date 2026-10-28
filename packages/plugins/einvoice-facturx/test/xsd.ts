import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';

/** Every .xsd under `dir`, by its path below it. */
function schemas(dir: string, base = dir): { fileName: string; contents: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return schemas(p, base);
    return f.endsWith('.xsd') ? [{ fileName: path.relative(base, p), contents: readFileSync(p, 'utf8') }] : [];
  });
}

/** Validates `xml` against `main` (a path below `dir`); returns the schema errors, none when valid. */
export async function validate(xml: string, dir: string, main: string): Promise<string[]> {
  const all = schemas(dir);
  const r = await validateXML({ xml: [{ fileName: 'doc.xml', contents: xml }], schema: all.find((s) => s.fileName === main)!, preload: all.filter((s) => s.fileName !== main), maxMemoryPages: 4096 });
  return r.valid ? [] : r.errors.map((e) => e.message ?? e.rawMessage);
}
