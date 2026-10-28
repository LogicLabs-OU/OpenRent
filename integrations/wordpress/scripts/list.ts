import { fileURLToPath } from 'node:url';
import { pluginStrings } from './strings.ts';

for (const [s, files] of pluginStrings(fileURLToPath(new URL('../openrent', import.meta.url)))) console.log(JSON.stringify(s), [...files].join(','));
