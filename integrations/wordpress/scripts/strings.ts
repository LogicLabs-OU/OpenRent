import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every translatable text in the plugin: __( '…', 'openrent' ) and its kin, in PHP and the blocks script. */
export function pluginStrings(root: string) {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(php|js)$/.test(f) && !f.endsWith('.l10n.php')) files.push(p);
    }
  };
  walk(root);
  const found = new Map<string, Set<string>>();
  const re = /\b(?:__|_e|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*['"]openrent['"]/g;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) {
      const s = m[2]!.replace(/\\(['"\\])/g, '$1');
      if (!found.has(s)) found.set(s, new Set());
      found.get(s)!.add(path.relative(root, f));
    }
  }
  return found;
}
