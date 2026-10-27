import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { themes } from '@openrent/core';
import { validateThemeMeta } from '@openrent/theme-sdk/manifest';
import type { Logger } from '@openrent/plugin-sdk';

export const DEFAULT_THEMES_JSON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../themes.json');

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** Reads the data parts of a theme package (theme.json, config/*.json, locales/*.json, widget/widget.css). */
export function readTheme(pkgDir: string, pkg: string): themes.InstalledTheme {
  const manifest = readJson(path.join(pkgDir, 'theme.json'));
  const config = (f: string, fallback: unknown) => (existsSync(path.join(pkgDir, 'config', f)) ? readJson(path.join(pkgDir, 'config', f)) : fallback);
  const localesDir = path.join(pkgDir, 'locales');
  const locales = existsSync(localesDir)
    ? Object.fromEntries(readdirSync(localesDir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), readJson(path.join(localesDir, f))]))
    : {};
  const sectionsDir = path.join(pkgDir, 'sections');
  const sectionSchemas = existsSync(sectionsDir)
    ? readdirSync(sectionsDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ ...readJson(path.join(sectionsDir, f)), type: f.replace(/\.json$/, '') }))
    : [];
  const widgetFile = path.join(pkgDir, 'widget', 'widget.css');
  const meta = {
    manifest, settingsSchema: config('settings_schema.json', []), settingsData: config('settings_data.json', {}), locales, sectionSchemas, sectionsData: config('sections_data.json', undefined),
    widgetCss: existsSync(widgetFile) ? readFileSync(widgetFile, 'utf8') : undefined,
  };
  return { ...meta, package: pkg, dir: pkgDir, problems: validateThemeMeta(meta) };
}

/**
 * Installed themes (FR-THM-3) listed in themes.json. The storefront compiles the same packages;
 * the API only needs their manifests, settings schemas and strings for the admin.
 */
export function loadThemes(logger: Logger, configPath: string | null = DEFAULT_THEMES_JSON, themesDir: string | null = null): themes.InstalledTheme[] {
  const list: string[] = configPath && existsSync(configPath) ? readJson(configPath).themes ?? [] : ['@openrent/theme-default'];
  const require = createRequire(import.meta.url);
  const out: themes.InstalledTheme[] = [];
  for (const pkg of list) {
    try {
      const dir = path.dirname(require.resolve(`${pkg}/package.json`));
      const theme = readTheme(dir, pkg);
      if (theme.problems.length) logger.warn({ theme: pkg, problems: theme.problems }, 'theme has problems and cannot be published');
      out.push(theme);
    } catch (err) {
      logger.error({ err, theme: pkg }, 'theme could not be read');
    }
  }
  // Operator-installed code themes, one folder each; the storefront compiles the same folders.
  if (themesDir && existsSync(themesDir)) {
    for (const name of readdirSync(themesDir)) {
      const dir = path.join(themesDir, name);
      if (!existsSync(path.join(dir, 'theme.json'))) continue;
      try {
        const theme = readTheme(dir, dir);
        if (out.some((t) => t.manifest.id === theme.manifest.id)) continue;
        out.push(theme);
      } catch (err) {
        logger.error({ err, theme: dir }, 'theme could not be read');
      }
    }
  }
  return out;
}
