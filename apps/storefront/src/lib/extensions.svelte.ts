/**
 * Values and errors of plugins' checkout fields (FR-PLG-5). The `checkout.extra_fields` slot fills it;
 * the runtime sends it with the order, so themes need no code for plugin fields.
 */
export const checkoutExtra = $state<{ values: Record<string, unknown>; errors: Record<string, string> }>({ values: {}, errors: {} });

export interface CheckoutFieldDef {
  key: string;
  type: 'text' | 'checkbox' | 'select';
  required: boolean;
  label: string;
  help: string | null;
  options: { value: string; label: string }[];
}
