// Registers the custom elements. Usage:
//   <script src="https://rent.example.com/widget/openrent-widget.js" data-openrent-api="https://rent.example.com"></script>
//   <openrent-product product="city-bike" shop="demo" storefront="https://shop.example.com"></openrent-product>
//   <openrent-category category="bikes" shop="demo" storefront="https://shop.example.com"></openrent-category>
import './Product.svelte';
import './Category.svelte';
import './BookButton.svelte';
import { openCheckout, returnedOrder } from './api.ts';

// Back from the payment page: show the booking over the merchant's page, using the page's widget settings.
function showReturnedOrder() {
  const back = returnedOrder();
  if (!back) return;
  const widget = document.querySelector('openrent-product, openrent-category');
  const attr = (name: string) => widget?.getAttribute(name) ?? undefined;
  void openCheckout({ order: back.order, token: back.token, paid: back.paid ? '1' : '', shop: attr('shop'), pk: attr('pk'), api: attr('api'), storefront: attr('storefront'), lang: attr('lang') });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showReturnedOrder);
else showReturnedOrder();
