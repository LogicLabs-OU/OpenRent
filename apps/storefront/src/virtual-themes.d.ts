declare module 'virtual:openrent-themes' {
  import type { ThemeModule } from '@openrent/theme-sdk';
  /** Code themes compiled into this storefront (themes.json and THEMES_DIR). */
  export const themes: ThemeModule[];
  export const sources: ({ pkg: string } | { dir: string })[];
}
