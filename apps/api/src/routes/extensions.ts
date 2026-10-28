import { audit, notifications, plugins, storefront, themes, AppError, serverT } from '@openrent/core';
import { confirmInstall, downloadZip, stagePlugin } from '../plugin-install.ts';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Router } from '../http.ts';
import { IdParams, Json, Nullable, Type } from '../schemas.ts';

const LocaleParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), locale: Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }) });

/** Plugin and theme management for the current tenant (PRD §3.16, §3.17). */
export function registerExtensions(r: Router) {
  const P = ['Plugins'];
  const installedPlugins = () => r.deps.plugins.statuses;

  r.get('/plugins', { permission: 'plugins:manage', tags: P, summary: 'Installed plugins with state, tenant enablement and settings (secrets masked)' }, async (ctx) => ({
    object: 'list',
    data: await plugins.listPlugins(ctx, installedPlugins()),
    hook_errors: r.deps.config.mode === 'single_tenant' ? r.deps.plugins.hookErrors : [],
    admin_slots: r.deps.plugins.slots,
    install_allowed: r.deps.config.allowPluginUpload && ctx.actor.type === 'user' && ctx.actor.role === 'owner',
  }));
  r.post(
    '/plugins/install',
    {
      permission: 'plugins:manage',
      tags: P,
      summary: 'Check a plugin package (multipart field "file" with a ZIP, or JSON { url }) and stage it; confirm to install. Owners only, and only when OPENRENT_ALLOW_PLUGIN_UPLOAD=true',
      status: 200,
    },
    async (ctx, req) => {
      if (!r.deps.config.allowPluginUpload) throw new AppError('plugin_upload_disabled', 403, serverT('plugins.install.disabled'));
      if (ctx.actor.type !== 'user' || ctx.actor.role !== 'owner') throw new AppError('forbidden', 403, serverT('plugins.install.owner_only'));
      let zip: Buffer;
      if (req.isMultipart()) {
        const part = await req.file();
        if (!part) throw new AppError('validation_error', 422, serverT('files.no_file'), { errors: [{ field: 'file', code: 'required', message: serverT('files.no_file') }] });
        zip = await part.toBuffer();
      } else zip = await downloadZip(String((req.body as { url?: string })?.url ?? ''));
      return stagePlugin(r.deps, zip);
    },
  );
  r.post(
    '/plugins/install/:id/actions/confirm',
    { permission: 'plugins:manage', tags: P, summary: 'Install a staged plugin; it loads after OpenRent restarts', params: Type.Object({ id: Type.String({ maxLength: 80 }) }), status: 200 },
    async (ctx, req) => {
      if (!r.deps.config.allowPluginUpload) throw new AppError('plugin_upload_disabled', 403, serverT('plugins.install.disabled'));
      if (ctx.actor.type !== 'user' || ctx.actor.role !== 'owner') throw new AppError('forbidden', 403, serverT('plugins.install.owner_only'));
      const out = await confirmInstall(r.deps, req.params.id);
      await audit(ctx, { entity_type: 'plugin', entity_id: out.plugin.id, action: 'install', extra: { version: out.plugin.version } });
      return out;
    },
  );
  // Admin extensions (FR-PLG-2): custom elements of plugins this shop has on, by outlet.
  r.get('/plugin_slots', { tags: P, summary: 'Admin extensions (custom elements) of the plugins this shop has on' }, async (ctx) => ({
    object: 'list',
    data: await plugins.adminSlots(ctx, r.deps.plugins.slots),
  }));
  r.get('/plugin_pages', { tags: P, summary: 'Pages of records the plugins this shop has on keep, for the admin to draw (plugin API 1.9)', querystring: Type.Object({ locale: Type.Optional(Type.String()) }) }, async (ctx, req) => ({
    object: 'list',
    data: await plugins.adminPages(ctx, req.query.locale ?? null),
  }));
  r.get(
    '/plugins/:id/ui/*',
    { tags: P, summary: 'A declared admin bundle of an installed plugin', params: Type.Object({ id: Type.String(), '*': Type.String() }), raw: true, tx: 'none' },
    async (_ctx, req, reply) => {
      const rel = req.params['*'];
      const dir = r.deps.plugins.dirs.get(req.params.id);
      const declared = r.deps.plugins.slots.some((s) => s.pluginId === req.params.id && s.bundleUrl === `/api/v1/plugins/${req.params.id}/ui/${rel}`);
      const file = dir ? path.resolve(dir, rel) : '';
      if (!dir || !declared || !file.startsWith(dir + path.sep) || !existsSync(file)) throw new AppError('not_found', 404, serverT('plugins.not_installed', { id: req.params.id }));
      return reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'private, max-age=300').send(await readFile(file));
    },
  );
  r.get('/plugins/:id', { permission: 'plugins:manage', tags: P, summary: 'One plugin', params: IdParams }, async (ctx, req) => plugins.getPlugin(ctx, installedPlugins(), req.params.id));
  r.patch(
    '/plugins/:id',
    {
      permission: 'plugins:manage',
      tags: P,
      summary: 'Enable, disable or configure a plugin for this shop. Secret settings are encrypted; null clears a value',
      params: IdParams,
      body: Type.Object({ enabled: Type.Optional(Type.Boolean()), config: Type.Optional(Type.Record(Type.String(), Nullable(Type.Union([Type.String(), Type.Number(), Type.Boolean()])))) }),
    },
    async (ctx, req) => {
      const out = await plugins.updatePlugin(ctx, installedPlugins(), req.params.id, req.body);
      // New email settings: try every waiting message again straight away instead of after its backoff.
      if (out.provides.some((p) => p.startsWith('notification:')) && out.enabled) await notifications.retryAllNotifications(ctx, 'queued');
      // Hooks pick up the new enablement once the change is committed.
      setTimeout(() => void r.deps.plugins.refreshEnablement(), 50);
      return out;
    },
  );

  const T = ['Themes'];
  // Code themes of the installation plus this shop's child themes (FR-THM-8).
  const installedThemes = (ctx: Parameters<typeof themes.availableThemes>[0]) => themes.availableThemes(ctx, r.deps.themes);

  r.get('/themes', { permission: 'themes:manage', tags: T, summary: 'Installed storefront themes and which one is live' }, async (ctx) => ({ object: 'list', data: await themes.listThemes(ctx, await installedThemes(ctx)) }));
  r.post(
    '/themes/install',
    { permission: 'themes:manage', tags: T, summary: 'Check a child theme package (multipart field "file", a ZIP) and show what it would add or change; confirm to install', status: 200 },
    async (ctx, req) => {
      const part = await req.file();
      if (!part) throw new AppError('validation_error', 422, serverT('files.no_file'), { errors: [{ field: 'file', code: 'required', message: serverT('files.no_file') }] });
      return themes.stageThemePackage(ctx, r.deps.themes, await part.toBuffer());
    },
  );
  r.post('/themes/install/:id/actions/confirm', { permission: 'themes:manage', tags: T, summary: 'Install or update the checked child theme', params: IdParams, status: 200 }, async (ctx, req) =>
    themes.confirmThemePackage(ctx, r.deps.themes, req.params.id),
  );
  r.delete('/themes/:id', { permission: 'themes:manage', tags: T, summary: 'Remove a child theme the shop installed (not the live one)', params: IdParams }, async (ctx, req) => themes.removeChildTheme(ctx, req.params.id));
  r.get('/themes/:id', { permission: 'themes:manage', tags: T, summary: 'Theme with settings schema, saved settings, defaults and strings', params: IdParams }, async (ctx, req) => themes.getTheme(ctx, await installedThemes(ctx), req.params.id));
  r.patch(
    '/themes/:id/settings',
    { permission: 'themes:manage', tags: T, summary: 'Save theme settings (validated against settings_schema.json); null resets to the default', params: IdParams, body: Type.Object({ settings: Json }) },
    async (ctx, req) => themes.updateThemeSettings(ctx, await installedThemes(ctx), req.params.id, req.body.settings),
  );
  r.patch(
    '/themes/:id/translations/:locale',
    { permission: 'themes:manage', tags: T, summary: 'Override theme strings for a locale; null or "" removes an override', params: LocaleParams, body: Type.Object({ strings: Type.Record(Type.String(), Nullable(Type.String())) }) },
    async (ctx, req) => themes.updateThemeTranslations(ctx, await installedThemes(ctx), req.params.id, req.params.locale, req.body.strings),
  );
  r.post('/themes/:id/actions/publish', { permission: 'themes:manage', tags: T, summary: 'Make the theme live on the storefront', params: IdParams, status: 200 }, async (ctx, req) =>
    themes.publishTheme(ctx, await installedThemes(ctx), req.params.id),
  );
  r.post('/themes/:id/actions/preview', { permission: 'themes:manage', tags: T, summary: 'Signed storefront link that renders this theme for one hour', params: IdParams, status: 200 }, async (ctx, req) => {
    const theme = (await installedThemes(ctx)).find((x) => x.manifest.id === req.params.id);
    if (!theme) throw new AppError('not_found', 404, serverT('themes.not_installed', { id: req.params.id }));
    const expires = new Date(ctx.now.getTime() + 60 * 60_000);
    const token = themes.previewToken(r.deps.config.sessionSecret, ctx.tenantId, req.params.id, expires);
    return { object: 'theme_preview', theme: req.params.id, url: `${r.deps.config.storefrontUrl}/?preview_theme=${encodeURIComponent(token)}`, expires_at: expires.toISOString() };
  });
  r.get('/themes/:id/settings/export', { permission: 'themes:manage', tags: T, summary: 'Download settings and string overrides as JSON', params: IdParams }, async (ctx, req) =>
    themes.exportThemeSettings(ctx, await installedThemes(ctx), req.params.id),
  );
  r.post(
    '/themes/:id/settings/import',
    {
      permission: 'themes:manage',
      tags: T,
      summary: 'Replace settings (and merge string overrides) from an export file',
      params: IdParams,
      body: Type.Object({ theme: Type.Optional(Type.String()), settings: Json, translations: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Nullable(Type.String())))), sections: Type.Optional(Type.Union([Type.Array(Json, { maxItems: 100 }), Type.Null()])) }),
      status: 200,
    },
    async (ctx, req) => themes.importThemeSettings(ctx, await installedThemes(ctx), req.params.id, req.body as any),
  );

  r.put(
    '/themes/:id/sections',
    {
      permission: 'themes:manage',
      tags: ['Themes'],
      summary: 'Save the home page layout (sections with settings and blocks); null restores the theme default',
      params: IdParams,
      body: Type.Object({ sections: Type.Union([Type.Array(Json, { maxItems: 100 }), Type.Null()]) }),
    },
    async (ctx, req) => themes.updateThemeSections(ctx, await installedThemes(ctx), req.params.id, req.body.sections),
  );
  r.put(
    '/themes/:id/content/:locale',
    {
      permission: 'themes:manage',
      tags: ['Themes'],
      summary: 'Translate shop texts of a theme (settings and home page sections) into one storefront language',
      params: LocaleParams,
      body: Type.Object({ values: Type.Record(Type.String({ maxLength: 200 }), Nullable(Type.String({ maxLength: 5000 }))) }),
    },
    async (ctx, req) => themes.updateThemeContent(ctx, await installedThemes(ctx), req.params.id, req.params.locale, req.body.values),
  );
  const Code = ['Themes'];
  r.get('/storefront_code', { permission: 'themes:manage', tags: Code, summary: "The shop's custom CSS and header/footer HTML" }, async (ctx) => ({ object: 'storefront_code', ...(await storefront.getStorefrontCode(ctx)) }));
  r.put(
    '/storefront_code',
    {
      permission: 'themes:manage',
      tags: Code,
      summary: 'Save custom CSS and header/footer HTML. Scripts, event handlers, inline styles and @import are removed; `warnings` names the fields that changed.',
      body: Type.Object({
        css: Type.Optional(Type.String()),
        header_html: Type.Optional(Type.String()),
        footer_html: Type.Optional(Type.String()),
        translations: Type.Optional(Type.Record(Type.String(), Type.Object({ header_html: Type.Optional(Type.String()), footer_html: Type.Optional(Type.String()) }))),
      }),
    },
    async (ctx, req) => storefront.saveStorefrontCode(ctx, req.body),
  );
}
