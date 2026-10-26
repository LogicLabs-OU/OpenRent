import { validateTheme, type TemplateName, type ThemeModule } from '@openrent/theme-sdk';
import defaultTheme from '@openrent/theme-default';
import { themes as compiled } from 'virtual:openrent-themes';
import { logger } from './logger.ts';

/**
 * Installed themes (FR-THM-3). Each is validated against the theme API on startup; an invalid
 * theme is refused with its problems listed, and the default theme is used instead.
 */
const installed: Record<string, ThemeModule> = Object.fromEntries([defaultTheme, ...compiled].map((t) => [t.manifest.id, t]));
export const themeProblems: Record<string, string[]> = {};
for (const [id, t] of Object.entries(installed)) {
  const problems = validateTheme(t);
  if (problems.length) {
    themeProblems[id] = problems;
    delete installed[id];
    logger.error({ theme: id, problems }, 'theme refused');
  }
}

export function themeFor(id: string | undefined): ThemeModule {
  return installed[id ?? 'default'] ?? installed.default ?? defaultTheme;
}

/** A theme's template; optional ones it leaves out (theme API 1.3) come from the default theme. */
export function templateFor(id: string | undefined, name: TemplateName) {
  return themeFor(id).templates[name] ?? defaultTheme.templates[name];
}
