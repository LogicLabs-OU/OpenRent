/**
 * Values and errors of plugins' checkout fields (FR-PLG-5). The `checkout.extra_fields` slot fills it;
 * the runtime sends it with the order, so themes need no code for plugin fields.
 */
export const checkoutExtra = $state<{ values: Record<string, unknown>; errors: Record<string, string> }>({ values: {}, errors: {} });

/**
 * Options picked in the slots of choice bundles (FR-CAT-6), by the bundle's variant id. The
 * `product.before_add` slot fills it; adding the bundle to the cart sends them, so themes need no code.
 */
export const bundlePicks = $state<Record<string, Record<string, string>>>({});

/** Accessories ticked on a product page (FR-CAT-7), by the product's variant id: added to the cart with it. */
export const accessoryChoices = $state<Record<string, string[]>>({});

export interface CheckoutFieldDef {
  key: string;
  type: 'text' | 'checkbox' | 'select';
  required: boolean;
  label: string;
  help: string | null;
  options: { value: string; label: string }[];
}
