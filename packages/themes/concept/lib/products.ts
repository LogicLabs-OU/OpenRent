import type { Category, Product } from '@openrent/theme-sdk';

/** The first price of a product, its free count on the chosen dates (undefined without dates) and its categories. */
export function facts(product: Product, categories: Category[]) {
  const price = product.variants.find((v) => v.price)?.price;
  const avail = product.variants.some((v) => v.available !== undefined)
    ? product.variants.reduce((a, v) => a + (v.available ?? 99), 0)
    : undefined;
  const cats = categories.filter((c) => product.category_ids.includes(c.id));
  const summary =
    price?.description ??
    (product.bundle ? product.bundle.components.map((c) => `${c.quantity}× ${c.name}`).join(' + ') : '');
  return { price, avail, cats, summary };
}
