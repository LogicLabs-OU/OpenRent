import {
  themeCatalogs,
  type SectionInstance,
  type SectionSchema,
  type ThemeModule,
} from '@openrent/theme-sdk';
import manifest from './theme.json';
import settingsSchema from './config/settings_schema.json';
import settingsData from './config/settings_data.json';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import et from './locales/et.json';
import ja from './locales/ja.json';
import sectionsData from './config/sections_data.json';
import hero from './sections/hero.json';
import statement from './sections/statement.json';
import categoryTiles from './sections/category-tiles.json';
import productGrid from './sections/product-grid.json';
import richText from './sections/rich-text.json';
import imageText from './sections/image-text.json';
import faq from './sections/faq.json';
import cta from './sections/cta.json';
import layout from './layouts/theme.svelte';
import index from './templates/index.svelte';
import collection from './templates/collection.svelte';
import product from './templates/product.svelte';
import cart from './templates/cart.svelte';
import checkout from './templates/checkout.svelte';
import orderConfirmation from './templates/order-confirmation.svelte';
import page from './templates/page.svelte';
import notFound from './templates/404.svelte';
import account from './templates/account.svelte';
import accountLogin from './templates/account-login.svelte';
import search from './templates/search.svelte';
import sign from './templates/sign.svelte';

/** Nightfall: a dark, cinematic shop with glowing gradients, glass panels and scroll-lit headlines. */
const theme: ThemeModule = {
  manifest,
  settingsSchema: settingsSchema as ThemeModule['settingsSchema'],
  settingsData,
  layout,
  templates: {
    index,
    collection,
    product,
    cart,
    checkout,
    'order-confirmation': orderConfirmation,
    page,
    '404': notFound,
    account,
    'account-login': accountLogin,
    search,
    sign,
  },
  locales: themeCatalogs({ en, de, fr, es, et, ja }),
  // The file name is the section type, as the API reads sections/<type>.json.
  sectionSchemas: Object.entries({
    hero,
    statement,
    'category-tiles': categoryTiles,
    'product-grid': productGrid,
    'rich-text': richText,
    'image-text': imageText,
    faq,
    cta,
  }).map(([type, s]) => ({ ...s, type }) as SectionSchema),
  sectionsData: sectionsData as SectionInstance[],
};

export default theme;
