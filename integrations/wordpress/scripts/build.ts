import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pluginStrings } from './strings.ts';

/**
 * Writes the plugin's translations from i18n/<lang>.json: WordPress's PHP translation files
 * (languages/openrent-<locale>.l10n.php, WordPress 6.5+) and the blocks script's JSON (Jed format, named by
 * the script's path). Every text in the plugin must be translated in every language.
 */
const LOCALES: Record<string, string> = { de: 'de_DE', fr: 'fr_FR', es: 'es_ES', et: 'et', ja: 'ja', nl: 'nl_NL' };
const root = fileURLToPath(new URL('../openrent', import.meta.url));
const strings = pluginStrings(root);
const php = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const problems: string[] = [];

for (const [lang, locale] of Object.entries(LOCALES)) {
  const t: Record<string, string> = JSON.parse(readFileSync(new URL(`../i18n/${lang}.json`, import.meta.url), 'utf8'));
  for (const s of strings.keys()) if (!t[s]) problems.push(`${lang}: missing "${s}"`);
  for (const s of Object.keys(t)) if (!strings.has(s)) problems.push(`${lang}: "${s}" is no longer used`);
  const messages = [...strings.keys()].filter((s) => t[s]).map((s) => `\t\t${php(s)} => ${php(t[s]!)},`);
  writeFileSync(`${root}/languages/openrent-${locale}.l10n.php`, `<?php\n// Made by scripts/build.ts from i18n/${lang}.json.\nreturn array(\n\t'domain' => 'openrent',\n\t'language' => '${locale}',\n\t'messages' => array(\n${messages.join('\n')}\n\t),\n);\n`);
  const js = [...strings].filter(([s, files]) => t[s] && [...files].some((f) => f.endsWith('.js')));
  const jed = { domain: 'messages', locale_data: { messages: { '': { domain: 'messages', lang: locale }, ...Object.fromEntries(js.map(([s]) => [s, [t[s]]])) } } };
  writeFileSync(`${root}/languages/openrent-${locale}-${createHash('md5').update('assets/blocks.js').digest('hex')}.json`, `${JSON.stringify(jed)}\n`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${strings.size} texts in ${Object.keys(LOCALES).length} languages`);
