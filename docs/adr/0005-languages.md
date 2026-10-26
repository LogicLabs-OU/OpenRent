# ADR 0005: Languages

Status: accepted

## Languages and catalogues

- Supported: `en`, `de`, `fr`, `es`, `et`, `ja`. The list lives once, in `@openrent/i18n`, with each language's own name, Accept-Language matching (`pickLocale`, regional variants such as `de-AT` fall back to `de`) and the message formatter. The theme SDK re-exports it as `SUPPORTED_LOCALES`.
- English is the base. Every lookup falls back to `en.json`; keys starting with `_` (`_meta`) are ignored.
- The typed `t()` stays. Messages use `{param}` and ICU-style plurals (`{count, plural, =0 {…} one {…} other {…}}`) with `Intl.PluralRules`, so each language uses its own plural forms. Theme texts use the same syntax now; the `key.one` / `key.other` pairs of theme API 1.3 (ADR 0004) are gone from the bundled themes.
- Themes pass their `locales/*.json` files through `themeCatalogs()` from the SDK, which drops `_meta` and other non-text values.
- Non-English catalogues are machine drafts (`_meta.machine_draft`) until a native speaker reviews them. `pnpm check:i18n` (in CI) checks that every language has the English keys, placeholders and plural `other` forms.

## Back office

- The language is per staff user (`users.locale`, `PATCH /auth/me`), chosen in the user menu. Before sign-in the browser language is used. The admin also sets `setFormatLocale` in `@openrent/ui`, so amounts change format with the text without a reload.
- Catalogues other than English are loaded on demand. The locale is reactive state, so switching re-renders without a reload.

## Server texts

- The API picks the language per request: the staff user's locale, else Accept-Language. Route handlers run inside `withLocale` (AsyncLocalStorage), so core error messages are translated without passing a locale through every service call.
- Emails and documents render in the customer's language, else the shop default (`tenants.locale`, kept equal to `storefront.default_locale`). Staff emails use the shop default.
- Built-in email and document templates call `{{t "key" param=value}}`, so one template serves every language. A shop that edits a built-in template gets it expanded into plain text for the chosen language and saves a copy for that language only.
- Japanese PDFs need CJK fonts; the Docker images install `fonts-noto-cjk` and the document CSS lists Noto Sans JP and Hiragino Sans.

## Storefront

- The shop enables languages (`storefront.locales`) and picks a default. Pages live under an optional `[[lang=locale]]` route segment: the default language has plain URLs, the others a prefix (`/de/p/kayak`). The `_or` endpoints stay at the root and read the language from `X-Or-Locale`.
- A disabled language gives 404, and the default language with a prefix redirects (301) to the plain URL. On a first visit without the `or_lang` cookie, Accept-Language picks an enabled language and the visitor is redirected (302); every page view sets the cookie, so a visitor who picks the default is not redirected again. Requests without Accept-Language (most bots) are not redirected.
- Pages set `<html lang>` and `hreflang` alternates with `x-default`.
- The runtime adds the prefix to every `rt.url.*` helper and offers `rt.url.switchLocale(l)`. Layout `path` values include the prefix, so themes compare against `rt.url.*` instead of fixed strings.

## Texts the shop edits

- Products, categories and now variants have a `translations` JSONB column (`{locale: {name, description}}`). Empty values fall back to the base fields, which hold the default language.
- Home page sections and text settings: translatable fields (text, textarea, link labels) are stored per language in `theme_content_translations[themeId][locale]`, keyed by path (`settings.<id>`, `sections.<sid>.<id>`, `sections.<sid>.blocks.<bid>.<id>`). The SDK applies the overlay in `resolveSections` and `resolveSettings`. Layout, images and numbers stay shared.
- Rental terms (`terms.translations`) and header/footer HTML (`storefront_code.translations`) have optional per-language versions. Each language's terms text has its own hash; checkout accepts the hash of any enabled language.
- Orders keep the base product names; translated names are for display (quotes, cart, catalogue).

## Widget

- `<openrent-product lang="de">`, else the host page's `<html lang>`, else English. The widget sends the language to the API for product names.
